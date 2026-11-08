import Foundation
import HTTPTypes
import KamaalLogger
import OpenAPIRuntime
import Testing

@testable import TCGClient

@Suite("Card request diagnostics")
struct RequestDiagnosticsMiddlewareTests {
    @Test(arguments: [
        ("/app-api/cards?query=private-search", "cards.list", 500),
        ("/app-api/collections/private-owner/pages/private-page", "collections.page", 503),
        ("/app-api/pricing/search?query=private-search", "pricing.search", 429),
    ])
    func `Logs HTTP failures without reading the body or logging private request values`(
        path: String,
        operation: String,
        status: Int
    ) async throws {
        let holder = LogHolder(max: nil)
        let middleware = RequestDiagnosticsMiddleware(logger: KamaalLogger(from: Self.self, holder: holder))
        let baseURL = try #require(URL(string: "https://example.com"))
        let header = try #require(HTTPField.Name("tcg-request-id"))
        let result = try await middleware.intercept(
            HTTPRequest(method: .get, scheme: "https", authority: "example.com", path: path),
            body: nil,
            baseURL: baseURL,
            operationID: "read"
        ) { _, _, _ in
            (
                HTTPResponse(status: .init(code: status), headerFields: [header: "pricing-test-123"]),
                HTTPBody("private-body")
            )
        }
        let body = try await String(collecting: #require(result.1), upTo: 1000)
        let logs = await clientLogs(holder)
        let entry = try #require(logs.first)
        #expect(result.0.status.code == status)
        #expect(body == "private-body")
        #expect(
            entry.message.contains(
                "operation=\(operation); status=\(status); request_id=pricing-test-123; duration_ms="
            )
        )
        #expect(logs.allSatisfy { !$0.message.contains("private") })
    }

    @Test
    func `Transport failures preserve their error and have no fabricated HTTP status`() async throws {
        let holder = LogHolder(max: nil)
        let middleware = RequestDiagnosticsMiddleware(logger: KamaalLogger(from: Self.self, holder: holder))
        let baseURL = try #require(URL(string: "https://example.com"))
        await #expect(throws: URLError.self) {
            _ = try await middleware.intercept(
                HTTPRequest(method: .get, scheme: "https", authority: "example.com", path: "/app-api/cards"),
                body: nil,
                baseURL: baseURL,
                operationID: "read"
            ) { _, _, _ in
                throw URLError(.notConnectedToInternet, userInfo: [NSLocalizedDescriptionKey: "private-error"])
            }
        }
        let logs = await clientLogs(holder)
        #expect(logs.contains { $0.message.contains("reason=transport_failed; status=none") })
        #expect(logs.allSatisfy { !$0.message.contains("private-error") })
    }

    @Test
    func `Decoding failures report their stage without the sensitive decoding description`() async throws {
        let holder = LogHolder(max: nil)
        RequestDiagnosticsMiddleware.processingFailure(
            DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "private-payload")),
            operation: "cards.list",
            logger: KamaalLogger(from: Self.self, holder: holder)
        )
        let logs = await clientLogs(holder)
        #expect(logs.contains { $0.message.contains("reason=decoding_failed") })
        #expect(logs.allSatisfy { !$0.message.contains("private-payload") })
    }

    @Test
    func `Successful responses remain unchanged without a failure log`() async throws {
        let holder = LogHolder(max: nil)
        let middleware = RequestDiagnosticsMiddleware(logger: KamaalLogger(from: Self.self, holder: holder))
        let baseURL = try #require(URL(string: "https://example.com"))
        let result = try await middleware.intercept(
            HTTPRequest(method: .get, scheme: "https", authority: "example.com", path: "/app-api/cards"),
            body: nil,
            baseURL: baseURL,
            operationID: "read"
        ) { _, _, _ in (HTTPResponse(status: .ok), nil) }
        #expect(result.0.status == .ok)
        #expect(await holder.logs.isEmpty)
    }
}
