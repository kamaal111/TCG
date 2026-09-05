import Foundation
import Testing

@testable import TCGDesignSystem

@Suite("URL session card image loader tests", .serialized)
struct URLSessionCardImageLoaderTests {
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

    private func makeLoader() -> URLSessionCardImageLoader {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubURLProtocol.self]
        return URLSessionCardImageLoader(
            session: URLSession(configuration: configuration),
            maximumConcurrentLoads: 2,
            maximumDecodedImageCount: 128,
            retryDelay: { _, _ in }
        )
    }

    private static let png = Data(
        base64Encoded:
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
    )!
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
