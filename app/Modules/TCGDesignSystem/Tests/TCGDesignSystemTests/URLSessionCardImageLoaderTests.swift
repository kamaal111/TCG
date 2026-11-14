import Foundation
import Testing

@testable import TCGDesignSystem

@Suite("URL session card image loader tests", .serialized)
struct URLSessionCardImageLoaderTests {
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

        #expect(await makeLoader().image(for: url) != nil)
        #expect(await makeLoader().image(for: url) != nil)
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
        let file = root.appending(path: URLSessionCardImageLoader.key(for: url))
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try corrupt.write(to: file)
        let loader = makeLoader()

        #expect(await loader.image(for: url) == nil)
        #expect(try Data(contentsOf: file) == corrupt)
        #expect(await loader.image(for: url) != nil)
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
        let loader = makeLoader()

        #expect(try await loader.inventory().isEmpty)
        #expect(await loader.image(for: first) != nil)
        #expect(await loader.image(for: second) != nil)
        let artwork = try await loader.inventory()
        #expect(artwork.map(\.byteCount).sorted() == [4096, 8192])
        let smaller = try #require(artwork.first { $0.byteCount == 4096 })
        #expect(await loader.thumbnail(for: smaller) != nil)

        try await loader.delete(smaller)
        #expect(loader.cachedImage(for: first) == nil)
        #expect(try await loader.inventory().map(\.byteCount) == [8192])
        #expect(await loader.image(for: first) != nil)
        #expect(requests.value == 3)

        try await loader.delete()
        #expect(try await loader.inventory().isEmpty)
        #expect(loader.cachedImage(for: first) == nil)
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
        let loader = makeLoader { _, _ in
            started.yield(())
            var iterator = retryResumed.makeAsyncIterator()
            _ = await iterator.next()
        }

        let load = Task { await loader.image(for: url) }
        var iterator = retryStarted.makeAsyncIterator()
        _ = await iterator.next()
        try await loader.delete()
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
        let loader = makeLoader()
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
        let loader = makeLoader()
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
        let loader = makeLoader()
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
        let loader = makeLoader()
        let url = try #require(URL(string: "https://images.example.com/non-http.png"))

        let image = await loader.image(for: url)

        #expect(image == nil)
    }

    @Test
    func `Returns nil when an image cannot be decoded`() async throws {
        StubURLProtocol.handler = { _ in
            .http(status: 200, headers: ["Content-Type": "image/png"], body: Data("not an image".utf8))
        }
        let loader = makeLoader()
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
        let loader = makeLoader()
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
        let loader = makeLoader()
        let url = try #require(URL(string: "https://images.example.com/cancelled.png"))

        let image = await loader.image(for: url)

        #expect(image == nil)
    }

    @Test
    func `Returns nil for a non-timeout network failure`() async throws {
        StubURLProtocol.handler = { _ in
            .error(URLError(.notConnectedToInternet))
        }
        let loader = makeLoader()
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
        let loader = makeLoader()
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
        let loader = makeLoader()
        let url = try #require(URL(string: "https://images.example.com/shared.png"))

        async let first = loader.image(for: url)
        async let second = loader.image(for: url)
        let images = await [first, second]

        #expect(images.allSatisfy { $0 != nil })
        #expect(requests.value == 1)
    }

    private func makeLoader(
        retryDelay: @escaping @Sendable (Int, HTTPURLResponse?) async -> Void = { _, _ in }
    ) -> URLSessionCardImageLoader {

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubURLProtocol.self]
        return URLSessionCardImageLoader(
            session: URLSession(configuration: configuration),
            root: root,
            maximumConcurrentLoads: 2,
            maximumDecodedImageCount: 128,
            retryDelay: retryDelay
        )
    }

    private static let png = Data(
        base64Encoded:
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
    )!
}

private final class TemporaryArtworkDirectory: Sendable {
    let url = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)

    deinit {
        try? FileManager.default.removeItem(at: url)
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
