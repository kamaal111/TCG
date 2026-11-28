import Foundation
import ImageIO
import KamaalLogger
import KamaalUtils

public enum ImageCachePolicy: Sendable {
    case temporary
    case persistent
}

public struct CachedImage: Identifiable, Sendable {
    public let id: String
    public let byteCount: Int64
    public let expiresAt: Date?
}

actor ImageRequestCoordinator {
    private static let searchLifetime: TimeInterval = 86_400
    private static let fileKeys: Set<URLResourceKey> = [.fileSizeKey, .isRegularFileKey, .contentModificationDateKey]

    private let root: URL
    private let now: @Sendable () -> Date
    private let maximumConcurrentLoads: Int
    private var activeAttempts = 0
    private var waitingAttempts: [AttemptWaiter] = []
    private var inFlight: [String: Load] = [:]
    private var observers: [UUID: AsyncStream<Void>.Continuation] = [:]

    #if os(iOS)
        private var backgroundPreparation: Task<Void, Never>?
        private var responseWaiters: [UUID: CheckedContinuation<BackgroundImageTransfer.Response, any Error>] = [:]
        private var backgroundResponses: [UUID: Result<BackgroundImageTransfer.Response, any Error>] = [:]
        private var applyingResponses: Set<UUID> = []
        private var drainWaiters: [CheckedContinuation<Void, Never>] = []
        private var backgroundInvalidated = false
    #endif

    init(root: URL, now: @escaping @Sendable () -> Date, maximumConcurrentLoads: Int) {
        self.root = root
        self.now = now
        self.maximumConcurrentLoads = maximumConcurrentLoads
    }

    func image(
        for key: String,
        loader: ImageLoader,
        url: URL,
        policy: ImageCachePolicy,
        priority: ImageRequestPriority
    ) async -> LoadedImage? {
        guard !Task.isCancelled else { return nil }
        if let image = loader.cachedImage(forKey: key, policy: policy) { return image }

        if inFlight[key] == nil, let image = readImage(for: key, loader: loader, policy: policy) {
            return image
        }

        let consumerID = UUID()
        return await withTaskCancellationHandler {
            await withCheckedContinuation { continuation in
                guard !Task.isCancelled else {
                    continuation.resume(returning: nil)
                    return
                }
                if inFlight[key] == nil {
                    startLoad(
                        key: key,
                        loader: loader,
                        url: url,
                        policy: policy,
                        shouldCache: true,
                        transferID: nil,
                        attempt: 1
                    )
                }
                if priority == .standard { inFlight[key]?.keepsDownloading = true }
                inFlight[key]?.consumers[consumerID] = Consumer(priority: priority, continuation: continuation)
                promoteLoad(for: key, to: policy, loader: loader)
            }
        } onCancel: {
            Task { await self.cancelConsumer(consumerID, for: key, loader: loader) }
        }
    }

    private func promoteLoad(for key: String, to policy: ImageCachePolicy, loader: ImageLoader) {
        guard policy == .persistent, inFlight[key]?.policy == .temporary else { return }
        inFlight[key]?.policy = .persistent
        #if os(iOS)
            do {
                try persistBackgroundRequest(for: key, transport: loader.transport)
            } catch {
                ImageLoader.logger.warning(
                    "Could not retain background artwork",
                    fields: [.init("description", error.localizedDescription)]
                )
            }
        #endif
    }

    private func cancelConsumer(_ id: UUID, for key: String, loader: ImageLoader) {
        guard let consumer = inFlight[key]?.consumers.removeValue(forKey: id) else { return }
        consumer.continuation.resume(returning: nil)
        guard let load = inFlight[key], !load.isApplyingAttempt, !load.hasDemand else { return }
        finishLoad(for: key, loadID: load.id, loader: loader, artwork: nil)
        load.task.cancel()
        if let index = waitingAttempts.firstIndex(where: { $0.key == key }) {
            waitingAttempts.remove(at: index).continuation.resume(returning: false)
        }
    }

    private func startLoad(
        key: String,
        loader: ImageLoader,
        url: URL,
        policy: ImageCachePolicy,
        shouldCache: Bool,
        transferID: UUID?,
        attempt: Int
    ) {
        let loadID = UUID()
        let task = Task {
            let artwork = await loader.download(url, attempt: attempt) { currentAttempt in
                let restoredID = currentAttempt == attempt ? transferID : nil
                return try await self.fetch(
                    key: key,
                    loadID: loadID,
                    loader: loader,
                    url: url,
                    attempt: currentAttempt,
                    restoredID: restoredID
                )
            } prepareRetry: {
                await self.prepareRetry(for: key, loadID: loadID, loader: loader)
            }
            finishLoad(for: key, loadID: loadID, loader: loader, artwork: artwork)
        }
        inFlight[key] = Load(
            id: loadID,
            task: task,
            url: url,
            policy: policy,
            shouldCache: shouldCache,
            transferID: transferID,
            attempt: attempt,
            keepsDownloading: transferID != nil,
            isApplyingAttempt: transferID != nil
        )
    }

    private func fetch(
        key: String,
        loadID: UUID,
        loader: ImageLoader,
        url: URL,
        attempt: Int,
        restoredID: UUID?
    ) async throws -> (Data, URLResponse?) {
        if restoredID == nil {
            guard await acquireAttempt(for: key, loadID: loadID) else { throw CancellationError() }
        }
        defer {
            activeAttempts -= 1
            startWaitingAttempts()
        }
        guard inFlight[key]?.hasDemand == true else {
            finishLoad(for: key, loadID: loadID, loader: loader, artwork: nil)
            throw CancellationError()
        }
        switch loader.transport {
        case .foreground(let session):
            let (data, response) = try await session.data(from: url)
            return (data, response)
        #if os(iOS)
            case .background(let background):
                let response = try await backgroundResponse(
                    for: key,
                    url: url,
                    attempt: attempt,
                    restoredID: restoredID,
                    background: background
                )
                return (response.data, response.response)
        #endif
        }
    }

    private func acquireAttempt(for key: String, loadID: UUID) async -> Bool {
        guard inFlight[key]?.id == loadID, inFlight[key]?.hasDemand == true else { return false }
        return await withCheckedContinuation { continuation in
            waitingAttempts.append(AttemptWaiter(key: key, continuation: continuation))
            startWaitingAttempts()
        }
    }

    var waitingAttemptCount: Int { waitingAttempts.count }

    private func startWaitingAttempts() {
        while activeAttempts < maximumConcurrentLoads, !waitingAttempts.isEmpty {
            // Use the consumers' current priorities so joining a load can promote it in place.
            let index = waitingAttempts.firstIndex { inFlight[$0.key]?.isSupplemental == false } ?? 0
            let waiter = waitingAttempts.remove(at: index)
            activeAttempts += 1
            inFlight[waiter.key]?.isApplyingAttempt = true
            waiter.continuation.resume(returning: true)
        }
    }

    private func prepareRetry(for key: String, loadID: UUID, loader: ImageLoader) -> Bool {
        guard let load = inFlight[key], load.id == loadID else { return false }
        guard load.hasDemand else {
            finishLoad(for: key, loadID: loadID, loader: loader, artwork: nil)
            return false
        }
        #if os(iOS)
            // Keep the receipt restorable during backoff while letting UIKit finish this event batch.
            if let id = load.transferID { settleResponse(id) }
        #endif
        inFlight[key]?.isApplyingAttempt = false
        return true
    }

    private func finishLoad(
        for key: String,
        loadID: UUID,
        loader: ImageLoader,
        artwork: DownloadedImage?
    ) {
        guard let load = inFlight[key], load.id == loadID else { return }
        inFlight.removeValue(forKey: key)
        defer {
            #if os(iOS)
                if let id = load.transferID, case .background(let background) = loader.transport {
                    finishTransfer(id, background: background)
                }
            #endif
            for consumer in load.consumers.values {
                consumer.continuation.resume(returning: artwork?.image)
            }
        }
        guard let artwork, load.shouldCache else { return }

        do {
            let expiry = try save(artwork.data, for: key, policy: load.policy)
            if load.policy == .persistent || expiry != nil {
                loader.cache(artwork.image, for: key, expiresAt: expiry)
            }
            notifyObservers()
        } catch {
            ImageLoader.logger.warning(
                "Could not save downloaded card artwork",
                fields: [.init("description", error.localizedDescription)]
            )
        }
    }

    #if os(iOS)
        func prepareBackground(_ background: any BackgroundImageTransferring, loader: ImageLoader) async {
            if let backgroundPreparation {
                await backgroundPreparation.value
                return
            }
            let preparation = Task {
                let restored = await background.restore()
                activeAttempts += restored.count
                for transfer in restored {
                    let request = transfer.request
                    let key = ImageLoader.key(for: request.url)
                    if let response = transfer.response {
                        backgroundResponses[transfer.id] = .success(response)
                        applyingResponses.insert(transfer.id)
                    }
                    startLoad(
                        key: key,
                        loader: loader,
                        url: request.url,
                        policy: request.policy,
                        shouldCache: request.shouldCache,
                        transferID: transfer.id,
                        attempt: request.attempt
                    )
                }

                // The stream preserves callback order, including the end of each UIKit delivery batch.
                let completion = loader.backgroundCompletion
                Task {
                    for await event in background.events {
                        switch event {
                        case .completed(let id, let response):
                            receive(response, id: id, background: background)
                        case .invalidated:
                            backgroundInvalidated = true
                            for (id, waiter) in responseWaiters {
                                applyingResponses.insert(id)
                                waiter.resume(throwing: URLError(.backgroundSessionWasDisconnected))
                            }
                            responseWaiters.removeAll()
                            await waitForCurrentResponses()
                            await completion.finish()
                        case .drained:
                            await waitForCurrentResponses()
                            await completion.finish()
                        }
                    }
                }
            }
            backgroundPreparation = preparation
            await preparation.value
        }

        private func backgroundResponse(
            for key: String,
            url: URL,
            attempt: Int,
            restoredID: UUID?,
            background: any BackgroundImageTransferring
        ) async throws -> BackgroundImageTransfer.Response {
            if let restoredID, let result = backgroundResponses.removeValue(forKey: restoredID) {
                return try result.get()
            }
            guard !backgroundInvalidated else { throw URLError(.backgroundSessionWasDisconnected) }

            if let restoredID {
                return try await withCheckedThrowingContinuation { responseWaiters[restoredID] = $0 }
            }

            if let previousID = inFlight[key]?.transferID {
                finishTransfer(previousID, background: background)
            }
            let id = UUID()
            inFlight[key]?.transferID = id
            inFlight[key]?.attempt = attempt
            try persistBackgroundRequest(for: key, transport: .background(background))
            return try await withCheckedThrowingContinuation { continuation in
                responseWaiters[id] = continuation
                background.start(url, id: id)
            }
        }

        private func receive(
            _ response: Result<BackgroundImageTransfer.Response, any Error>,
            id: UUID,
            background: any BackgroundImageTransferring
        ) {
            guard !applyingResponses.contains(id) else { return }
            guard let load = inFlight.values.first(where: { $0.transferID == id }) else {
                background.discard(id)
                return
            }
            guard load.isApplyingAttempt else { return }
            applyingResponses.insert(id)
            if let waiter = responseWaiters.removeValue(forKey: id) {
                waiter.resume(with: response)
            } else {
                backgroundResponses[id] = response
            }
        }

        private func persistBackgroundRequest(for key: String, transport: ImageLoader.Transport) throws {
            guard case .background(let background) = transport,
                let load = inFlight[key], let id = load.transferID
            else { return }
            try background.save(
                .init(url: load.url, policy: load.policy, shouldCache: load.shouldCache, attempt: load.attempt),
                id: id
            )
        }

        private func finishTransfer(_ id: UUID, background: any BackgroundImageTransferring) {
            background.discard(id)
            settleResponse(id)
        }

        private func settleResponse(_ id: UUID) {
            applyingResponses.remove(id)
            backgroundResponses.removeValue(forKey: id)
            if applyingResponses.isEmpty {
                let waiters = drainWaiters
                drainWaiters.removeAll()
                for waiter in waiters { waiter.resume() }
            }
        }

        private func waitForCurrentResponses() async {
            guard !applyingResponses.isEmpty else { return }
            await withCheckedContinuation { drainWaiters.append($0) }
        }
    #endif

    private func readImage(for key: String, loader: ImageLoader, policy: ImageCachePolicy)
        -> LoadedImage?
    {
        let collectionFile = file(for: key, policy: .persistent)
        if let image = decodeFile(collectionFile) {
            loader.cache(image, for: key, expiresAt: nil)
            return image
        }

        let searchFile = file(for: key, policy: .temporary)
        guard let expiry = freshExpiration(of: searchFile, at: now()),
            let image = decodeFile(searchFile)
        else { return nil }

        if policy == .persistent {
            do {
                try promote(searchFile, to: collectionFile)
                loader.cache(image, for: key, expiresAt: nil)
                notifyObservers()
                return image
            } catch {
                ImageLoader.logger.warning(
                    "Could not retain collection card artwork",
                    fields: [.init("description", error.localizedDescription)]
                )
            }
        }
        loader.cache(image, for: key, expiresAt: expiry)
        return image
    }

    private func promote(_ source: URL, to destination: URL) throws {
        try prepareDirectory(for: .persistent)
        if FileManager.default.fileExists(atPath: destination.path) {
            _ = try FileManager.default.replaceItemAt(destination, withItemAt: source)
        } else {
            try FileManager.default.moveItem(at: source, to: destination)
        }
    }

    private func save(_ data: Data, for key: String, policy: ImageCachePolicy) throws -> Date? {
        let destination = file(for: key, policy: policy)
        try prepareDirectory(for: policy)
        try data.write(to: destination, options: .atomic)
        guard policy == .temporary else { return nil }

        try FileManager.default.setAttributes([.modificationDate: now()], ofItemAtPath: destination.path)
        return expiration(of: destination)
    }

    private func decodeFile(_ url: URL) -> LoadedImage? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return LoadedImage.decode(data)
    }

    func removeExpiredImages() {
        _ = try? freshSearchFiles()
    }

    private func freshSearchFiles() throws -> [(url: URL, expiresAt: Date)] {
        var fresh: [(url: URL, expiresAt: Date)] = []
        var removed = false
        let time = now()
        for file in try artworkFiles(for: .temporary) {
            if let expiresAt = freshExpiration(of: file, at: time) {
                fresh.append((file, expiresAt))
                continue
            }
            do {
                try FileManager.default.removeItem(at: file)
                removed = true
            } catch {
                ImageLoader.logger.warning(
                    "Could not remove expired card artwork",
                    fields: [.init("description", error.localizedDescription)]
                )
            }
        }
        if removed { notifyObservers() }
        return fresh
    }

    func inventory() throws -> [CachedImage] {
        var artwork: [String: CachedImage] = [:]
        for (url, expiresAt) in try freshSearchFiles() {
            let cached = try inventoryEntry(for: url, expiresAt: expiresAt)
            artwork[cached.id] = cached
        }
        for url in try artworkFiles(for: .persistent) {
            let cached = try inventoryEntry(for: url, expiresAt: nil)
            artwork[cached.id] = cached
        }
        return artwork.values.sorted { $0.id < $1.id }
    }

    private func inventoryEntry(for url: URL, expiresAt: Date?) throws -> CachedImage {
        let values = try url.resourceValues(forKeys: Self.fileKeys)
        return CachedImage(
            id: url.lastPathComponent,
            byteCount: Int64(values.fileSize ?? 0),
            expiresAt: expiresAt
        )
    }

    private func artworkFiles(for policy: ImageCachePolicy) throws -> [URL] {
        let files: [URL]
        do {
            files = try FileManager.default.contentsOfDirectory(
                at: directory(for: policy),
                includingPropertiesForKeys: Array(Self.fileKeys),
                options: .skipsHiddenFiles
            )
        } catch let error as CocoaError where error.code == .fileReadNoSuchFile {
            return []
        }
        return try files.filter { try $0.resourceValues(forKeys: Self.fileKeys).isRegularFile == true }
    }

    private func expiration(of url: URL) -> Date? {
        let values = try? url.resourceValues(forKeys: Self.fileKeys)
        return values?.contentModificationDate?.addingTimeInterval(Self.searchLifetime)
    }

    private func freshExpiration(of url: URL, at time: Date) -> Date? {
        guard let expiry = expiration(of: url), time < expiry else { return nil }
        return expiry
    }

    func changes() -> AsyncStream<Void> {
        let id = UUID()
        let (stream, continuation) = AsyncStream<Void>.makeStream(bufferingPolicy: .bufferingNewest(1))
        observers[id] = continuation
        continuation.onTermination = { [weak self] _ in
            Task { await self?.removeObserver(id) }
        }
        continuation.yield(())
        return stream
    }

    func thumbnail(for artwork: CachedImage) -> CGImage? {
        let collectionFile = file(for: artwork.id, policy: .persistent)
        let searchFile = file(for: artwork.id, policy: .temporary)
        let searchSource = { () -> CGImageSource? in
            guard self.freshExpiration(of: searchFile, at: self.now()) != nil else { return nil }
            return CGImageSourceCreateWithURL(searchFile as CFURL, nil)
        }
        guard let source = CGImageSourceCreateWithURL(collectionFile as CFURL, nil) ?? searchSource() else {
            return nil
        }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: 320,
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
            return nil
        }
        return image
    }

    func delete(_ artwork: CachedImage?, loader: ImageLoader) throws {
        let key = artwork?.id
        loader.invalidate(key)
        for pendingKey in Array(inFlight.keys) where key == nil || key == pendingKey {
            inFlight[pendingKey]?.shouldCache = false
            #if os(iOS)
                try persistBackgroundRequest(for: pendingKey, transport: loader.transport)
            #endif
        }

        defer { notifyObservers() }
        if let key {
            var deletionError: (any Error)?
            for policy: ImageCachePolicy in [.persistent, .temporary] {
                do {
                    try removeItemIfPresent(at: file(for: key, policy: policy))
                } catch {
                    deletionError = error
                }
            }
            if let deletionError { throw deletionError }
        } else {
            try removeItemIfPresent(at: root)
        }
    }

    private func removeItemIfPresent(at url: URL) throws {
        do {
            try FileManager.default.removeItem(at: url)
        } catch let error as CocoaError
            where error.code == .fileNoSuchFile || error.code == .fileReadNoSuchFile
        {
            return
        }
    }

    private func prepareDirectory(for policy: ImageCachePolicy) throws {
        var directory = try FileClerk.getOrCreateDirectory(at: directory(for: policy))
        var resources = URLResourceValues()
        resources.isExcludedFromBackup = true
        try directory.setResourceValues(resources)
    }

    private func directory(for policy: ImageCachePolicy) -> URL {
        switch policy {
        case .persistent: root.appending(path: "collection", directoryHint: .isDirectory)
        case .temporary: root
        }
    }

    private func file(for key: String, policy: ImageCachePolicy) -> URL {
        directory(for: policy).appending(path: key, directoryHint: .notDirectory)
    }

    private func notifyObservers() {
        for observer in observers.values {
            observer.yield(())
        }
    }

    private func removeObserver(_ id: UUID) {
        observers.removeValue(forKey: id)
    }

    private struct AttemptWaiter {
        let key: String
        let continuation: CheckedContinuation<Bool, Never>
    }

    private struct Consumer {
        let priority: ImageRequestPriority
        let continuation: CheckedContinuation<LoadedImage?, Never>
    }

    private struct Load {
        let id: UUID
        let task: Task<Void, Never>
        let url: URL
        var policy: ImageCachePolicy
        var shouldCache: Bool
        var transferID: UUID?
        var attempt: Int
        var keepsDownloading: Bool
        var isApplyingAttempt: Bool
        var consumers: [UUID: Consumer] = [:]

        var hasDemand: Bool { keepsDownloading || !consumers.isEmpty }

        var isSupplemental: Bool {
            !keepsDownloading && consumers.values.allSatisfy { $0.priority == .searchSupplemental }
        }
    }
}
