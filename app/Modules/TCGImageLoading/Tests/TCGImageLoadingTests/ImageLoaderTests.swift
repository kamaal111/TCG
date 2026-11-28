import Foundation
import Synchronization
import Testing

@testable import TCGImageLoading

@Suite("URL session card image loader tests", .serialized)
struct ImageLoaderTests {
    private let directory = TemporaryArtworkDirectory()
    private var root: URL { directory.url }

    @Test
    func `Reads a saved image through a fresh loader without a second request`() async throws {
        let requests = RequestCounter()
        StubURLProtocol.handler = { _ in
            _ = requests.increment()
            return .http(status: 200, headers: ["Cache-Control": "no-store"], body: Self.png)
        }
        let url = try #require(URL(string: "https://images.example.com/binder-card.png"))

        #expect(await makeLoader(now: Date.init, retryDelay: { _, _ in }).image(for: url) != nil)
        #expect(await makeLoader(now: Date.init, retryDelay: { _, _ in }).image(for: url, policy: .temporary) != nil)
        #expect(requests.value == 1)
    }

    @Test
    func `Repairs a corrupt file only after a decodable response`() async throws {
        let requests = RequestCounter()
        let corrupt = Data("corrupt".utf8)
        StubURLProtocol.handler = { _ in
            .http(status: 200, headers: [:], body: requests.increment() == 1 ? Data() : Self.png)
        }
        let url = try #require(URL(string: "https://images.example.com/corrupt.png"))
        let file = root.appending(path: ImageLoader.key(for: url))
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try corrupt.write(to: file)
        let loader = makeLoader(now: Date.init, retryDelay: { _, _ in })

        #expect(await loader.image(for: url, policy: .temporary) == nil)
        #expect(try Data(contentsOf: file) == corrupt)
        #expect(await loader.image(for: url, policy: .temporary) != nil)
        #expect(try Data(contentsOf: file) == Self.png)
        #expect(requests.value == 2)
    }

    @Test
    func `Inventories variants and deletes stored and decoded artwork`() async throws {
        let requests = RequestCounter()
        StubURLProtocol.handler = { request in
            _ = requests.increment()
            let count = request.url?.query == "variant=1" ? 4096 : 8192
            let paddedPNG = Self.png + Data(repeating: 0, count: count - Self.png.count)
            return .http(status: 200, headers: [:], body: paddedPNG)
        }
        let first = try #require(URL(string: "https://images.example.com/card.png?variant=1"))
        let second = try #require(URL(string: "https://images.example.com/card.png?variant=2"))
        let loader = makeLoader(now: Date.init, retryDelay: { _, _ in })

        #expect(try await loader.inventory().isEmpty)
        #expect(await loader.image(for: first, policy: .temporary) != nil)
        #expect(await loader.image(for: second) != nil)
        let artwork = try await loader.inventory()
        #expect(artwork.map(\.byteCount).sorted() == [4096, 8192])
        let smaller = try #require(artwork.first { $0.byteCount == 4096 })
        #expect(await loader.thumbnail(for: smaller) != nil)

        try await loader.delete(smaller)
        #expect(loader.cachedImage(for: first, policy: .temporary) == nil)
        #expect(try await loader.inventory().map(\.byteCount) == [8192])
        #expect(await loader.image(for: first, policy: .temporary) != nil)
        #expect(requests.value == 3)

        try await loader.delete(nil)
        #expect(try await loader.inventory().isEmpty)
        #expect(loader.cachedImage(for: first, policy: .temporary) == nil)
        #expect(loader.cachedImage(for: second) == nil)
    }

    @Test
    func `Clearing the cache invalidates an in-flight download`() async throws {
        let requests = RequestCounter()
        let (retryStarted, started) = AsyncStream<Void>.makeStream()
        let (retryResumed, resumed) = AsyncStream<Void>.makeStream()
        defer { resumed.finish() }
        StubURLProtocol.handler = { _ in
            let status = requests.increment() == 1 ? 503 : 200
            return .http(status: status, headers: [:], body: Self.png)
        }
        let url = try #require(URL(string: "https://images.example.com/in-flight.png"))
        let loader = makeLoader(
            now: Date.init,
            retryDelay: { _, _ in
                started.yield(())
                var iterator = retryResumed.makeAsyncIterator()
                _ = await iterator.next()
            }
        )

        let load = Task { await loader.image(for: url) }
        var iterator = retryStarted.makeAsyncIterator()
        _ = await iterator.next()
        try await loader.delete(nil)
        resumed.yield(())
        #expect(await load.value != nil)
        #expect(loader.cachedImage(for: url) == nil)
        #expect(try await loader.inventory().isEmpty)

        #expect(await loader.image(for: url) != nil)
        #expect(requests.value == 3)
    }

    @Test
    func `Retries a busy image response without requiring a new view`() async throws {
        let requests = RequestCounter()
        let responses: [StubURLProtocol.Result] = [
            .http(status: 503, headers: ["Retry-After": "1"], body: Data()),
            .http(status: 200, headers: ["Content-Type": "image/png"], body: Self.png),
        ]
        StubURLProtocol.handler = { _ in
            responses[requests.increment() - 1]
        }
        let loader = makeLoader(now: Date.init, retryDelay: { _, _ in })
        let url = try #require(URL(string: "https://images.example.com/retry.png"))

        let image = await loader.image(for: url)

        #expect(image != nil)
        #expect(requests.value == 2)
    }

    @Test
    func `Retries a rate-limited image response`() async throws {
        let requests = RequestCounter()
        let responses: [StubURLProtocol.Result] = [
            .http(status: 429, headers: [:], body: Data()),
            .http(status: 200, headers: ["Content-Type": "image/png"], body: Self.png),
        ]
        StubURLProtocol.handler = { _ in
            responses[requests.increment() - 1]
        }
        let loader = makeLoader(now: Date.init, retryDelay: { _, _ in })
        let url = try #require(URL(string: "https://images.example.com/rate-limited.png"))

        let image = await loader.image(for: url)

        #expect(image != nil)
        #expect(requests.value == 2)
    }

    @Test
    func `Does not retry a non-retryable HTTP response`() async throws {
        let requests = RequestCounter()
        StubURLProtocol.handler = { _ in
            _ = requests.increment()
            return .http(status: 404, headers: [:], body: Data())
        }
        let loader = makeLoader(now: Date.init, retryDelay: { _, _ in })
        let url = try #require(URL(string: "https://images.example.com/missing.png"))

        let image = await loader.image(for: url)

        #expect(image == nil)
        #expect(requests.value == 1)
    }

    @Test
    func `Returns nil for a non-HTTP response`() async throws {
        StubURLProtocol.handler = { _ in
            .urlResponse(body: Self.png)
        }
        let loader = makeLoader(now: Date.init, retryDelay: { _, _ in })
        let url = try #require(URL(string: "https://images.example.com/non-http.png"))

        let image = await loader.image(for: url)

        #expect(image == nil)
    }

    @Test
    func `Returns nil when an image cannot be decoded`() async throws {
        StubURLProtocol.handler = { _ in
            .http(status: 200, headers: ["Content-Type": "image/png"], body: Data("not an image".utf8))
        }
        let loader = makeLoader(now: Date.init, retryDelay: { _, _ in })
        let url = try #require(URL(string: "https://images.example.com/invalid.png"))

        let image = await loader.image(for: url)

        #expect(image == nil)
    }

    @Test
    func `Retries a timed-out image request`() async throws {
        let requests = RequestCounter()
        let responses: [StubURLProtocol.Result] = [
            .error(URLError(.timedOut)),
            .http(status: 200, headers: ["Content-Type": "image/png"], body: Self.png),
        ]
        StubURLProtocol.handler = { _ in
            responses[requests.increment() - 1]
        }
        let loader = makeLoader(now: Date.init, retryDelay: { _, _ in })
        let url = try #require(URL(string: "https://images.example.com/timed-out.png"))

        let image = await loader.image(for: url)

        #expect(image != nil)
        #expect(requests.value == 2)
    }

    @Test
    func `Returns nil for a cancelled image request`() async throws {
        StubURLProtocol.handler = { _ in
            .error(URLError(.cancelled))
        }
        let loader = makeLoader(now: Date.init, retryDelay: { _, _ in })
        let url = try #require(URL(string: "https://images.example.com/cancelled.png"))

        let image = await loader.image(for: url)

        #expect(image == nil)
    }

    @Test
    func `Returns nil for a non-timeout network failure`() async throws {
        StubURLProtocol.handler = { _ in
            .error(URLError(.notConnectedToInternet))
        }
        let loader = makeLoader(now: Date.init, retryDelay: { _, _ in })
        let url = try #require(URL(string: "https://images.example.com/offline.png"))

        let image = await loader.image(for: url)

        #expect(image == nil)
    }

    @Test
    func `Stops retrying after the maximum number of attempts`() async throws {
        let requests = RequestCounter()
        StubURLProtocol.handler = { _ in
            _ = requests.increment()
            return .http(status: 503, headers: [:], body: Data())
        }
        let loader = makeLoader(now: Date.init, retryDelay: { _, _ in })
        let url = try #require(URL(string: "https://images.example.com/unavailable.png"))

        let image = await loader.image(for: url)

        #expect(image == nil)
        #expect(requests.value == 10)
    }

    @Test
    func `Coalesces concurrent requests for the same image`() async throws {
        let requests = RequestCounter()
        StubURLProtocol.handler = { _ in
            _ = requests.increment()
            Thread.sleep(forTimeInterval: 0.05)
            return .http(status: 200, headers: ["Content-Type": "image/png"], body: Self.png)
        }
        let loader = makeLoader(now: Date.init, retryDelay: { _, _ in })
        let url = try #require(URL(string: "https://images.example.com/shared.png"))

        async let first = loader.image(for: url, policy: .temporary)
        async let second = loader.image(for: url, policy: .persistent)
        let images = await [first, second]

        #expect(images.allSatisfy { $0 != nil })
        #expect(loader.cachedImage(for: url, policy: .persistent) != nil)
        #expect(requests.value == 1)
    }

    @Test
    func `Search artwork survives relaunch until the original 24 hour deadline`() async throws {
        let requests = RequestCounter()
        StubURLProtocol.handler = { _ in
            _ = requests.increment()
            return .http(status: 200, headers: [:], body: Self.png)
        }
        let clock = ArtworkTestClock()
        let now: @Sendable () -> Date = { clock.now }
        let url = try #require(URL(string: "https://images.example.com/search.png"))
        let file = root.appending(path: ImageLoader.key(for: url))
        let loader = makeLoader(now: now, retryDelay: { _, _ in })

        #expect(await loader.image(for: url, policy: .temporary) != nil)
        let timestamp = try #require(
            file.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate
        )
        let deadline = timestamp.addingTimeInterval(86_400)
        #expect(try await loader.inventory().first?.expiresAt == deadline)
        let reopened = makeLoader(now: now, retryDelay: { _, _ in })
        clock.set(timestamp.addingTimeInterval(86_399))

        #expect(await reopened.image(for: url, policy: .temporary) != nil)
        #expect(try await reopened.inventory().first?.expiresAt == deadline)
        #expect(requests.value == 1)
        clock.set(deadline)

        #expect(reopened.cachedImage(for: url, policy: .temporary) == nil)
        #expect(try await reopened.inventory().isEmpty)
        #expect(await makeLoader(now: now, retryDelay: { _, _ in }).image(for: url, policy: .temporary) != nil)
        #expect(requests.value == 2)
    }

    @Test
    func `Maintenance removes old flat files and keeps promoted artwork`() async throws {
        let requests = RequestCounter()
        StubURLProtocol.handler = { _ in
            _ = requests.increment()
            return .http(status: 200, headers: [:], body: Self.png)
        }
        let clock = ArtworkTestClock()
        let now: @Sendable () -> Date = { clock.now }
        let url = try #require(URL(string: "https://images.example.com/promoted.png"))
        let legacy = try #require(URL(string: "https://images.example.com/legacy.png"))
        let key = ImageLoader.key(for: url)
        let file = root.appending(path: key)
        let legacyFile = root.appending(path: ImageLoader.key(for: legacy))
        let loader = makeLoader(now: now, retryDelay: { _, _ in })

        #expect(await loader.image(for: url, policy: .temporary) != nil)
        try Self.png.write(to: legacyFile)
        #expect(await loader.image(for: url, policy: .persistent) != nil)
        #expect(!FileManager.default.fileExists(atPath: file.path))
        #expect(FileManager.default.fileExists(atPath: legacyFile.path))
        let promoted = try #require(try await loader.inventory().first { $0.id == key })
        #expect(promoted.expiresAt == nil)

        clock.set(Date.now.addingTimeInterval(86_401))
        await loader.removeExpiredImages()

        #expect(!FileManager.default.fileExists(atPath: legacyFile.path))
        #expect(try await loader.inventory().map(\.id) == [key])
        #expect(await makeLoader(now: now, retryDelay: { _, _ in }).image(for: url, policy: .temporary) != nil)
        #expect(requests.value == 1)
    }

    @Test
    func `Inventory prefers collection artwork when both copies exist`() async throws {
        StubURLProtocol.handler = { _ in
            .http(status: 200, headers: [:], body: Self.png)
        }
        let loader = makeLoader(now: Date.init, retryDelay: { _, _ in })
        let url = try #require(URL(string: "https://images.example.com/duplicate.png"))
        let key = ImageLoader.key(for: url)
        #expect(await loader.image(for: url, policy: .persistent) != nil)

        let searchCopy = Self.png + Data(repeating: 0, count: 4096)
        try searchCopy.write(to: root.appending(path: key))

        let inventory = try await loader.inventory()
        #expect(inventory.map(\.id) == [key])
        let artwork = try #require(inventory.first)
        #expect(artwork.byteCount == Int64(Self.png.count))
        #expect(artwork.expiresAt == nil)
    }

    @Test(.timeLimit(.minutes(1)))
    func `Visible artwork starts while two busy requests back off`() async throws {
        let first = try Self.imageURL("busy-first")
        let second = try Self.imageURL("busy-second")
        let visible = try Self.imageURL("visible")
        let retryGate = RetryGate()
        StubURLProtocol.handler = { request in
            .http(status: request.url == visible ? 200 : 503, headers: [:], body: Self.png)
        }
        let loader = makeLoader(now: Date.init, retryDelay: { _, _ in await retryGate.wait() })
        let firstLoad = Task { await loader.image(for: first, policy: .temporary, priority: .searchLead) }
        let secondLoad = Task { await loader.image(for: second, policy: .temporary, priority: .searchLead) }
        await retryGate.waitForTwoRetries()

        #expect(await loader.image(for: visible, policy: .temporary, priority: .searchLead) != nil)
        firstLoad.cancel()
        secondLoad.cancel()
        #expect(await firstLoad.value == nil)
        #expect(await secondLoad.value == nil)
        await retryGate.release()
    }

    #if os(iOS)
        @Test(.timeLimit(.minutes(1)))
        func `A collection request joins a restored search transfer and retains the image`() async throws {
            let url = try #require(URL(string: "https://images.example.com/shared-background.png"))
            let id = UUID()
            let background = BackgroundImageTransferStub(restored: [
                .init(
                    id: id,
                    request: .init(url: url, policy: .temporary, shouldCache: true, attempt: 1),
                    response: nil
                )
            ])
            defer { background.finish() }
            let loader = makeLoader(background: background)
            var requests = background.savedRequests.makeAsyncIterator()

            let collection = Task { await loader.image(for: url, policy: .persistent) }
            let promoted = await requests.next()
            #expect(promoted?.policy == .persistent)
            background.complete(id, response: try Self.backgroundResponse(url: url))

            #expect(await collection.value != nil)
            #expect(await loader.image(for: url, policy: .temporary) != nil)
            #expect(background.startCount == 0)
            let artwork = try await loader.inventory()
            #expect(artwork.count == 1)
            #expect(try #require(artwork.first).expiresAt == nil)
        }

        @Test(.timeLimit(.minutes(1)))
        func `A staged completion populates the cache without a view waiting`() async throws {
            let url = try #require(URL(string: "https://images.example.com/set-logo.png"))
            let background = BackgroundImageTransferStub(restored: [
                .init(
                    id: UUID(),
                    request: .init(url: url, policy: .persistent, shouldCache: true, attempt: 1),
                    response: try Self.backgroundResponse(url: url)
                )
            ])
            defer { background.finish() }
            let loader = makeLoader(background: background)
            var discarded = background.discardedTransfers.makeAsyncIterator()

            await loader.prepareBackgroundTransfers()
            #expect(await discarded.next() != nil)
            #expect(loader.cachedImage(for: url) != nil)
            #expect(try await loader.inventory().count == 1)
            #expect(background.startCount == 0)
        }

        @Test(.timeLimit(.minutes(1)))
        func `Clearing the cache invalidates the background write and leaves one transfer pending`() async throws {
            let url = try #require(URL(string: "https://images.example.com/clear-background.png"))
            let background = BackgroundImageTransferStub(restored: [])
            defer { background.finish() }
            let loader = makeLoader(background: background)
            var starts = background.startedTransfers.makeAsyncIterator()
            var requests = background.savedRequests.makeAsyncIterator()

            let first = Task { await loader.image(for: url, policy: .temporary) }
            let id = try #require(await starts.next())
            _ = await requests.next()
            try await loader.delete(nil)
            let cleared = await requests.next()
            #expect(cleared?.shouldCache == false)

            let second = Task { await loader.image(for: url, policy: .persistent) }
            let promoted = await requests.next()
            #expect(promoted?.policy == .persistent)
            #expect(promoted?.shouldCache == false)
            background.complete(id, response: try Self.backgroundResponse(url: url))

            #expect(await first.value != nil)
            #expect(await second.value != nil)
            #expect(background.startCount == 1)
            #expect(try await loader.inventory().isEmpty)
        }

        @Test(.timeLimit(.minutes(1)))
        func `Queued lead artwork starts in order before supplemental artwork and skips canceled rows`() async throws {
            let first = try Self.imageURL("active-first")
            let second = try Self.imageURL("active-second")
            let supplemental = try Self.imageURL("supplemental")
            let discarded = try Self.imageURL("old-result")
            let lead = try Self.imageURL("lead")
            let nextLead = try Self.imageURL("next-lead")
            let background = BackgroundImageTransferStub(restored: [])
            defer { background.finish() }
            let loader = makeLoader(background: background)
            var starts = background.startedTransfers.makeAsyncIterator()
            var requests = background.savedRequests.makeAsyncIterator()

            let firstLoad = Task { await loader.image(for: first, policy: .temporary, priority: .searchLead) }
            let firstID = try #require(await starts.next())
            #expect(await requests.next()?.url == first)
            let secondLoad = Task { await loader.image(for: second, policy: .temporary, priority: .searchLead) }
            let secondID = try #require(await starts.next())
            #expect(await requests.next()?.url == second)

            let supplementalLoad = Task {
                await loader.image(for: supplemental, policy: .temporary, priority: .searchSupplemental)
            }
            try await Self.waitForQueuedAttempts(1, loader: loader)
            let discardedLoad = Task {
                await loader.image(for: discarded, policy: .temporary, priority: .searchLead)
            }
            try await Self.waitForQueuedAttempts(2, loader: loader)
            let leadLoad = Task { await loader.image(for: lead, policy: .temporary, priority: .searchLead) }
            try await Self.waitForQueuedAttempts(3, loader: loader)
            let nextLeadLoad = Task { await loader.image(for: nextLead, policy: .temporary, priority: .searchLead) }
            try await Self.waitForQueuedAttempts(4, loader: loader)

            discardedLoad.cancel()
            #expect(await discardedLoad.value == nil)
            background.complete(firstID, response: try Self.backgroundResponse(url: first))
            let leadID = try #require(await starts.next())
            #expect(try #require(await requests.next()).url == lead)
            background.complete(leadID, response: try Self.backgroundResponse(url: lead))
            let nextLeadID = try #require(await starts.next())
            #expect(try #require(await requests.next()).url == nextLead)
            background.complete(nextLeadID, response: try Self.backgroundResponse(url: nextLead))
            let supplementalID = try #require(await starts.next())
            #expect(try #require(await requests.next()).url == supplemental)
            background.complete(supplementalID, response: try Self.backgroundResponse(url: supplemental))
            background.complete(secondID, response: try Self.backgroundResponse(url: second))

            #expect(await firstLoad.value != nil)
            #expect(await secondLoad.value != nil)
            #expect(await leadLoad.value != nil)
            #expect(await nextLeadLoad.value != nil)
            #expect(await supplementalLoad.value != nil)
            #expect(background.startCount == 5)
        }

        @Test(.timeLimit(.minutes(1)))
        func `The background event batch drains during backoff and the receipt survives until retry`() async throws {
            let url = try Self.imageURL("busy-background")
            let background = BackgroundImageTransferStub(restored: [])
            let (retryStarted, startingRetry) = AsyncStream<Void>.makeStream()
            let (resumeRetry, resumingRetry) = AsyncStream<Void>.makeStream()
            let (batchDrained, drainingBatch) = AsyncStream<Void>.makeStream()
            defer {
                background.finish()
                resumingRetry.finish()
            }
            let loader = ImageLoader(
                background: background,
                root: root,
                maximumConcurrentLoads: 2,
                now: Date.init,
                retryDelay: { _, _ in
                    startingRetry.yield(())
                    var resumes = resumeRetry.makeAsyncIterator()
                    _ = await resumes.next()
                }
            )
            await loader.backgroundCompletion.register { drainingBatch.yield(()) }
            var starts = background.startedTransfers.makeAsyncIterator()
            var retries = retryStarted.makeAsyncIterator()
            var drained = batchDrained.makeAsyncIterator()
            let load = Task { await loader.image(for: url, policy: .temporary, priority: .searchLead) }
            let first = try #require(await starts.next())
            let busy = try #require(HTTPURLResponse(url: url, statusCode: 503, httpVersion: nil, headerFields: nil))
            background.complete(first, response: .init(data: Data(), response: busy))
            background.drain()

            #expect(await retries.next() != nil)
            #expect(await drained.next() != nil)
            #expect(background.startCount == 1)
            #expect(background.discardCount == 0)

            resumingRetry.yield(())
            let second = try #require(await starts.next())
            #expect(second != first)
            #expect(background.discardCount == 1)
            background.complete(second, response: try Self.backgroundResponse(url: url))
            #expect(await load.value != nil)
        }

        @Test(.timeLimit(.minutes(1)))
        func `A submitted search image caches even after the row leaves`() async throws {
            let url = try Self.imageURL("leaving-row")
            let background = BackgroundImageTransferStub(restored: [])
            defer { background.finish() }
            let loader = makeLoader(background: background)
            var starts = background.startedTransfers.makeAsyncIterator()
            var discarded = background.discardedTransfers.makeAsyncIterator()
            let load = Task { await loader.image(for: url, policy: .temporary, priority: .searchLead) }

            let id = try #require(await starts.next())
            load.cancel()
            #expect(await load.value == nil)
            background.complete(id, response: try Self.backgroundResponse(url: url))

            #expect(await discarded.next() == id)
            #expect(loader.cachedImage(for: url, policy: .temporary) != nil)
        }

        @Test(.timeLimit(.minutes(1)))
        func `Canceling one search consumer still serves a joined collection request`() async throws {
            let url = try Self.imageURL("shared-result")
            let background = BackgroundImageTransferStub(restored: [])
            defer { background.finish() }
            let loader = makeLoader(background: background)
            var starts = background.startedTransfers.makeAsyncIterator()
            var requests = background.savedRequests.makeAsyncIterator()
            let search = Task { await loader.image(for: url, policy: .temporary, priority: .searchLead) }
            let id = try #require(await starts.next())
            #expect(await requests.next()?.policy == .temporary)

            let collection = Task { await loader.image(for: url, policy: .persistent) }
            #expect(await requests.next()?.policy == .persistent)
            search.cancel()
            #expect(await search.value == nil)
            background.complete(id, response: try Self.backgroundResponse(url: url))

            #expect(await collection.value != nil)
            #expect(background.startCount == 1)
        }

        private static func waitForQueuedAttempts(_ count: Int, loader: ImageLoader) async throws {
            let clock = ContinuousClock()
            let deadline = clock.now.advanced(by: .seconds(5))
            while await loader.waitingAttemptCount != count, clock.now < deadline {
                try await Task.sleep(for: .milliseconds(10))
            }
            try #require(await loader.waitingAttemptCount == count)
        }

        private func makeLoader(background: BackgroundImageTransferStub) -> ImageLoader {
            ImageLoader(
                background: background,
                root: root,
                maximumConcurrentLoads: 2,
                now: Date.init,
                retryDelay: { _, _ in }
            )
        }

        private static func backgroundResponse(url: URL) throws -> BackgroundImageTransfer.Response {
            let response = try #require(HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil))
            return .init(data: png, response: response)
        }
    #endif

    private func makeLoader(
        now: @escaping @Sendable () -> Date,
        retryDelay: @escaping @Sendable (Int, HTTPURLResponse?) async -> Void
    ) -> ImageLoader {

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubURLProtocol.self]
        return ImageLoader(
            session: URLSession(configuration: configuration),
            root: root,
            maximumConcurrentLoads: 2,
            maximumDecodedImageCount: 128,
            now: now,
            retryDelay: retryDelay
        )
    }

    private static func imageURL(_ name: String) throws -> URL {
        try #require(URL(string: "https://images.example.com/\(name).png"))
    }

    private static let png = Data(
        base64Encoded:
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
    )!
}

private actor RetryGate {
    private var retries: [CheckedContinuation<Void, Never>] = []
    private var bothStarted: CheckedContinuation<Void, Never>?

    func wait() async {
        await withCheckedContinuation { continuation in
            retries.append(continuation)
            if retries.count == 2 {
                bothStarted?.resume()
                bothStarted = nil
            }
        }
    }

    func waitForTwoRetries() async {
        guard retries.count < 2 else { return }
        await withCheckedContinuation { bothStarted = $0 }
    }

    func release() {
        for retry in retries { retry.resume() }
        retries.removeAll()
    }
}

private final class TemporaryArtworkDirectory: Sendable {
    let url = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)

    deinit {
        try? FileManager.default.removeItem(at: url)
    }
}

private final class ArtworkTestClock: Sendable {
    private let date = Mutex(Date.now)

    var now: Date { date.withLock { $0 } }

    func set(_ value: Date) {
        date.withLock { $0 = value }
    }
}

private final class RequestCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0

    var value: Int {
        lock.withLock { count }
    }

    func increment() -> Int {
        lock.withLock {
            count += 1
            return count
        }
    }
}

private final class StubURLProtocol: URLProtocol, @unchecked Sendable {
    enum Result: Sendable {
        case http(status: Int, headers: [String: String], body: Data)
        case urlResponse(body: Data)
        case error(URLError)
    }

    nonisolated(unsafe) static var handler: @Sendable (URLRequest) -> Result = { _ in
        .http(status: 500, headers: [:], body: Data())
    }

    override class func canInit(with request: URLRequest) -> Bool { true }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let result = Self.handler(request)
        switch result {
        case .http(let status, let headers, let body):
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: status,
                httpVersion: nil,
                headerFields: headers
            )!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: body)
            client?.urlProtocolDidFinishLoading(self)
        case .urlResponse(let body):
            let response = URLResponse(
                url: request.url!,
                mimeType: "image/png",
                expectedContentLength: body.count,
                textEncodingName: nil
            )
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: body)
            client?.urlProtocolDidFinishLoading(self)
        case .error(let error):
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}

#if os(iOS)
    private final class BackgroundImageTransferStub: BackgroundImageTransferring {
        let events: AsyncStream<BackgroundImageTransfer.Event>
        let savedRequests: AsyncStream<BackgroundImageTransfer.Request>
        let startedTransfers: AsyncStream<UUID>
        let discardedTransfers: AsyncStream<UUID>

        private let restored: [BackgroundImageTransfer.Restored]
        private let delivery: AsyncStream<BackgroundImageTransfer.Event>.Continuation
        private let saved: AsyncStream<BackgroundImageTransfer.Request>.Continuation
        private let started: AsyncStream<UUID>.Continuation
        private let discarded: AsyncStream<UUID>.Continuation
        private let starts = Mutex(0)
        private let discards = Mutex(0)

        init(restored: [BackgroundImageTransfer.Restored]) {
            self.restored = restored
            (events, delivery) = AsyncStream.makeStream()
            (savedRequests, saved) = AsyncStream.makeStream()
            (startedTransfers, started) = AsyncStream.makeStream()
            (discardedTransfers, discarded) = AsyncStream.makeStream()
        }

        var startCount: Int { starts.withLock { $0 } }
        var discardCount: Int { discards.withLock { $0 } }

        func restore() async -> [BackgroundImageTransfer.Restored] { restored }

        func save(_ request: BackgroundImageTransfer.Request, id: UUID) {
            saved.yield(request)
        }

        func start(_ url: URL, id: UUID) {
            starts.withLock { $0 += 1 }
            started.yield(id)
        }

        func discard(_ id: UUID) {
            discards.withLock { $0 += 1 }
            discarded.yield(id)
        }

        func complete(_ id: UUID, response: BackgroundImageTransfer.Response) {
            delivery.yield(.completed(id, .success(response)))
        }

        func drain() {
            delivery.yield(.drained)
        }

        func finish() {
            delivery.yield(.invalidated)
            delivery.finish()
        }
    }
#endif
