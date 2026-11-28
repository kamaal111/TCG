#if os(iOS)
    import Foundation
    import KamaalLogger

    protocol BackgroundImageTransferring: Sendable {
        var events: AsyncStream<BackgroundImageTransfer.Event> { get }

        func restore() async -> [BackgroundImageTransfer.Restored]

        func save(_ request: BackgroundImageTransfer.Request, id: UUID) throws

        func start(_ url: URL, id: UUID)

        func discard(_ id: UUID)
    }

    /// Adapts the system background session to ordered, durable download results.
    final class BackgroundImageTransfer: BackgroundImageTransferring {
        static let identifier = "\(Bundle.main.bundleIdentifier ?? "TCG").remote-images"
        private static let logger = KamaalLogger(from: BackgroundImageTransfer.self)

        let events: AsyncStream<Event>
        private let directory: URL
        private let session: URLSession

        init(directory: URL, configuration: URLSessionConfiguration) {
            self.directory = directory
            let (events, delivery) = AsyncStream<Event>.makeStream()
            self.events = events
            let delegate = Delegate(directory: directory, delivery: delivery)
            session = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
        }

        static func configuration() -> URLSessionConfiguration {
            let configuration = URLSessionConfiguration.background(withIdentifier: identifier)
            configuration.isDiscretionary = false
            configuration.sessionSendsLaunchEvents = true
            return configuration
        }

        func restore() async -> [Restored] {
            let tasks = await session.allTasks
            var active: [UUID: URLSessionTask] = [:]
            for task in tasks {
                guard let id = Self.transferID(for: task) else { continue }
                active[id] = task
            }

            let files =
                (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil))
                ?? []
            var restored: [Restored] = []
            var restoredURLs: Set<String> = []
            for file in files where file.pathExtension == "request" {
                guard let id = UUID(uuidString: file.deletingPathExtension().lastPathComponent) else { continue }
                guard let data = try? Data(contentsOf: file),
                    let request = try? PropertyListDecoder().decode(Request.self, from: data)
                else {
                    active.removeValue(forKey: id)?.cancel()
                    discard(id)
                    continue
                }

                guard !restoredURLs.contains(request.url.absoluteString) else {
                    active.removeValue(forKey: id)?.cancel()
                    discard(id)
                    continue
                }
                if let task = active.removeValue(forKey: id) {
                    if task.state == .suspended { task.resume() }
                    restoredURLs.insert(request.url.absoluteString)
                    let response = task.state == .completed ? try? Self.readResponse(id, in: directory) : nil
                    restored.append(Restored(id: id, request: request, response: response))
                } else if let response = try? Self.readResponse(id, in: directory) {
                    restoredURLs.insert(request.url.absoluteString)
                    restored.append(Restored(id: id, request: request, response: response))
                } else {
                    discard(id)
                }
            }
            for (id, task) in active {
                task.cancel()
                discard(id)
            }
            return restored
        }

        func save(_ request: Request, id: UUID) throws {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let file = Self.file(id, extension: "request", in: directory)
            try PropertyListEncoder().encode(request).write(to: file, options: .atomic)
        }

        func start(_ url: URL, id: UUID) {
            let task = session.downloadTask(with: url)
            task.taskDescription = id.uuidString
            task.resume()
        }

        func discard(_ id: UUID) {
            Self.removeResult(id, in: directory)
            try? FileManager.default.removeItem(at: Self.file(id, extension: "request", in: directory))
        }

        private static func transferID(for task: URLSessionTask) -> UUID? {
            task.taskDescription.flatMap(UUID.init(uuidString:))
        }

        private static func file(_ id: UUID, extension suffix: String, in directory: URL) -> URL {
            directory.appending(path: id.uuidString).appendingPathExtension(suffix)
        }

        private static func removeResult(_ id: UUID, in directory: URL) {
            try? FileManager.default.removeItem(at: file(id, extension: "response", in: directory))
            try? FileManager.default.removeItem(at: file(id, extension: "body", in: directory))
        }

        private static func readResponse(_ id: UUID, in directory: URL) throws -> Response {
            let metadata = try Data(contentsOf: file(id, extension: "response", in: directory))
            let receipt = try PropertyListDecoder().decode(Receipt.self, from: metadata)
            let data = try Data(contentsOf: file(id, extension: "body", in: directory))
            return Response(data: data, response: receipt.httpResponse)
        }

        struct Request: Codable, Sendable {
            let url: URL
            let shouldCache: Bool
            let attempt: Int
            private let retainsArtwork: Bool

            var policy: ImageCachePolicy { retainsArtwork ? .persistent : .temporary }

            init(url: URL, policy: ImageCachePolicy, shouldCache: Bool, attempt: Int) {
                self.url = url
                self.shouldCache = shouldCache
                self.attempt = attempt
                retainsArtwork = policy == .persistent
            }
        }

        struct Response: Sendable {
            let data: Data
            let response: HTTPURLResponse?
        }

        struct Restored: Sendable {
            let id: UUID
            let request: Request
            let response: Response?
        }

        enum Event: Sendable {
            case completed(UUID, Result<Response, any Error>)
            case invalidated
            case drained
        }

        private struct Receipt: Codable {
            let url: URL
            let status: Int?
            let retryAfter: String?

            var httpResponse: HTTPURLResponse? {
                guard let status else { return nil }
                let headers = retryAfter.map { ["Retry-After": $0] }
                return HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: headers)
            }
        }

        private final class Delegate: NSObject, URLSessionDownloadDelegate {
            private let directory: URL
            private let delivery: AsyncStream<Event>.Continuation

            init(directory: URL, delivery: AsyncStream<Event>.Continuation) {
                self.directory = directory
                self.delivery = delivery
            }

            func urlSession(
                _ session: URLSession,
                downloadTask: URLSessionDownloadTask,
                didFinishDownloadingTo location: URL
            ) {
                guard let id = transferID(for: downloadTask), let url = downloadTask.originalRequest?.url else {
                    return
                }
                let response = downloadTask.response as? HTTPURLResponse
                let receipt = Receipt(
                    url: url,
                    status: response?.statusCode,
                    retryAfter: response?.value(forHTTPHeaderField: "Retry-After")
                )
                do {
                    try stage(location, receipt: receipt, id: id)
                } catch {
                    removeResult(id, in: directory)
                    logger.warning(
                        "Could not stage a background image",
                        fields: [.init("description", error.localizedDescription)]
                    )
                }
            }

            private func stage(_ location: URL, receipt: Receipt, id: UUID) throws {
                let metadata = try PropertyListEncoder().encode(receipt)
                try FileManager.default.moveItem(at: location, to: file(id, extension: "body", in: directory))
                try metadata.write(to: file(id, extension: "response", in: directory), options: .atomic)
            }

            func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: (any Error)?) {
                guard let id = transferID(for: task) else { return }
                if let error {
                    removeResult(id, in: directory)
                    delivery.yield(.completed(id, .failure(error)))
                    return
                }
                let result = Result { try readResponse(id, in: directory) }
                delivery.yield(.completed(id, result))
            }

            func urlSession(_ session: URLSession, didBecomeInvalidWithError error: (any Error)?) {
                delivery.yield(.invalidated)
                delivery.finish()
            }

            func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
                delivery.yield(.drained)
            }
        }
    }

#endif

#if os(iOS)
    @MainActor
    final class BackgroundEventCompletion {
        private var handler: (() -> Void)?

        nonisolated init() {}

        func register(_ handler: @escaping () -> Void) {
            self.handler = handler
        }

        func finish() {
            let completion = handler
            handler = nil
            completion?()
        }
    }
#endif
