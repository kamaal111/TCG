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
        let logs = await holder.logs
        let entry = try #require(logs.first)
        #expect(result.0.status.code == status)
        #expect(body == "private-body")
        #expect(entry.message == "api.request.failed")
        #expect(entry.hasLogFields(["operation": operation, "status": String(status)]))
        #expect(entry.fields().contains { $0.name == "duration_ms" })
        #expect(entry.fields(includingPrivate: true).contains(.init("request_id", "pricing-test-123")))
        #expect(entry.fields().allSatisfy { $0.name != "request_id" })
        #expect(logs.allSatisfy { !$0.hasLogText("private") })
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
        let logs = await holder.logs
        #expect(logs.contains { $0.hasLogFields(["reason": "transport_failed", "status": "none"]) })
        #expect(logs.allSatisfy { !$0.hasLogText("private-error") })
    }

    @Test
    func `Decoding failures report their stage without the sensitive decoding description`() async throws {
        let holder = LogHolder(max: nil)
        RequestDiagnosticsMiddleware.processingFailure(
            DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "private-payload")),
            operation: "cards.list",
            logger: KamaalLogger(from: Self.self, holder: holder)
        )
        let logs = await holder.logs
        #expect(logs.contains { $0.hasLogFields(["reason": "decoding_failed"]) })
        #expect(logs.allSatisfy { !$0.hasLogText("private-payload") })
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
