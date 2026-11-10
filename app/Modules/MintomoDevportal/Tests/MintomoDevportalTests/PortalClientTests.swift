import Foundation
import HTTPTypes
import OpenAPIRuntime
import Testing

@testable import MintomoDevportal

struct PortalClientTests {
    private static let failures: [(Int, PortalClientError)] = [
        (400, .unavailable), (401, .unauthorized), (403, .forbidden), (404, .unavailable),
        (409, .conflict), (413, .unavailable), (503, .unavailable),
        (418, .unknown(status: 418, payload: nil, cause: nil)),
    ]

    @Test func `Sends the reviewed SHA and stable request ID`() async throws {
        let release = try PortalFixtures.release()
        let transport = PortalTransport(status: 202, data: try JSONEncoder().encode(release))
        let client = try makeClient(transport: transport)
        let result = try await client.start(
            sha: release.sha,
            fingerprint: release.fingerprint,
            requestID: release.requestId
        )
        .get()
        #expect(result.id == release.id)
        #expect(await transport.method == .post)
        #expect(await transport.path == "/v1/releases")
        #expect(await transport.operationID == "startRelease")
        let body = try #require(await transport.body)
        let request = try JSONDecoder().decode(Components.Schemas.StartRelease.self, from: body)
        #expect(request.sha == release.sha)
        #expect(request.fingerprint == release.fingerprint)
        #expect(request.requestId == release.requestId)
    }

    @Test func `Sends approval decisions to their release and approval`() async throws {
        let release = try PortalFixtures.release()
        let approval = try #require(release.approval)
        let transport = PortalTransport(status: 200, data: try JSONEncoder().encode(release))
        let client = try makeClient(transport: transport)
        let result = try await client.decide(
            .init(releaseID: release.id, approvalID: approval.id, approved: true, requestID: release.requestId)
        )
        .get()
        #expect(result.id == release.id)
        #expect(await transport.method == .post)
        #expect(await transport.path == "/v1/releases/\(release.id)/approvals/\(approval.id)")
        #expect(await transport.operationID == "answerApproval")
        let body = try #require(await transport.body)
        let request = try JSONDecoder().decode(Components.Schemas.ApprovalDecision.self, from: body)
        #expect(request.approved)
        #expect(request.requestId == release.requestId)
    }

    @Test func `Loads server status with the requested page`() async throws {
        let status = try PortalFixtures.server()
        let transport = PortalTransport(status: 200, data: try JSONEncoder().encode(status))
        let client = try makeClient(transport: transport)
        let result = try await client.server(page: 2)
            .get()
        #expect(result == status)
        #expect(await transport.method == .get)
        #expect(await transport.path == "/v1/server?page=2")
        #expect(await transport.operationID == "getServer")
    }

    @Test func `Loads an existing release`() async throws {
        let release = try PortalFixtures.release()
        let transport = PortalTransport(status: 200, data: try JSONEncoder().encode(release))
        let client = try makeClient(transport: transport)
        let result = try await client.release(id: release.id)
            .get()
        #expect(result == release)
        #expect(await transport.method == .get)
        #expect(await transport.path == "/v1/releases/\(release.id)")
        #expect(await transport.operationID == "getRelease")
    }

    @Test(arguments: PortalClientTests.failures)
    func `Maps server status failures to custom errors`(status: Int, expected: PortalClientError) async throws {
        let client = try makeClient(transport: failureTransport(status: status))
        let result = await client.server(page: 0)
        #expect(throws: expected) { try result.get() }
    }

    @Test(arguments: PortalClientTests.failures)
    func `Maps release start failures to custom errors`(status: Int, expected: PortalClientError) async throws {
        let client = try makeClient(transport: failureTransport(status: status))
        let result = await client.start(sha: "reviewed-sha", fingerprint: "reviewed-host", requestID: UUID().uuidString)
        #expect(throws: expected) { try result.get() }
    }

    @Test(arguments: PortalClientTests.failures)
    func `Maps release lookup failures to custom errors`(status: Int, expected: PortalClientError) async throws {
        let client = try makeClient(transport: failureTransport(status: status))
        let result = await client.release(id: UUID().uuidString)
        #expect(throws: expected) { try result.get() }
    }

    @Test(arguments: PortalClientTests.failures)
    func `Maps approval failures to custom errors`(status: Int, expected: PortalClientError) async throws {
        let client = try makeClient(transport: failureTransport(status: status))
        let result = await client.decide(
            .init(
                releaseID: UUID().uuidString,
                approvalID: UUID().uuidString,
                approved: true,
                requestID: UUID().uuidString
            )
        )
        #expect(throws: expected) { try result.get() }
    }

    @Test func `Captures malformed release start responses as custom failures`() async throws {
        let client = try makeClient(transport: PortalTransport(status: 202, data: Data("invalid JSON".utf8)))
        let result = await client.start(sha: "reviewed-sha", fingerprint: "reviewed-host", requestID: UUID().uuidString)
        #expect(throws: PortalClientError.unknown(status: 503, payload: nil, cause: nil)) { try result.get() }
    }

    @Test func `Captures transport failures at the typed result boundary`() async throws {
        let client = try makeClient(transport: PortalTransport(failure: URLError(.notConnectedToInternet)))
        let result = await client.server(page: 0)
        #expect(throws: PortalClientError.unknown(status: 503, payload: nil, cause: nil)) { try result.get() }
    }

    @Test(arguments: [
        "http://mini.example.ts.net", "https://example.com", "https://user:password@mini.example.ts.net",
        "https://mini.example.ts.net?token=value", "https://mini.example.ts.net#fragment",
    ])
    func `Rejects invalid service URLs with typed results`(address: String) throws {
        let url = try #require(URL(string: address))
        let result = PortalClientImpl.connect(url: url)
        #expect(throws: PortalClientError.invalidURL) { try result.get() }
    }

    @Test func `Accepts the dedicated HTTPS port selected by setup`() async throws {
        let url = try #require(URL(string: "https://mini.example.ts.net:8443"))
        let status = try PortalFixtures.server()
        let transport = PortalTransport(status: 200, data: try JSONEncoder().encode(status))
        let client = try PortalClientImpl.connect(url: url, transport: transport)
            .get()
        let result = try await client.server(page: 0)
            .get()
        #expect(result == status)
        #expect(await transport.baseURL?.port == 8443)
    }

    @Test func `Captures malformed server responses as custom failures`() async throws {
        let client = try makeClient(transport: PortalTransport(status: 200, data: Data("invalid JSON".utf8)))
        let result = await client.server(page: 0)
        #expect(throws: PortalClientError.unknown(status: 503, payload: nil, cause: nil)) { try result.get() }
    }

    @Test func `Captures malformed release responses as custom failures`() async throws {
        let client = try makeClient(transport: PortalTransport(status: 200, data: Data("invalid JSON".utf8)))
        let result = await client.release(id: UUID().uuidString)
        #expect(throws: PortalClientError.unknown(status: 503, payload: nil, cause: nil)) { try result.get() }
    }

    @Test func `Captures malformed approval responses as custom failures`() async throws {
        let client = try makeClient(transport: PortalTransport(status: 200, data: Data("invalid JSON".utf8)))
        let result = await client.decide(
            .init(
                releaseID: UUID().uuidString,
                approvalID: UUID().uuidString,
                approved: true,
                requestID: UUID().uuidString
            )
        )
        #expect(throws: PortalClientError.unknown(status: 503, payload: nil, cause: nil)) { try result.get() }
    }

    private func makeClient(transport: PortalTransport) throws -> PortalClientImpl {
        try PortalClientImpl.connect(url: #require(URL(string: "https://mini.example.ts.net")), transport: transport)
            .get()
    }

    private func failureTransport(status: Int) -> PortalTransport {
        PortalTransport(
            status: status,
            data: Data(
                """
                {"message":"Safe failure","code":"ERROR"}
                """.utf8
            )
        )
    }
}

private actor PortalTransport: ClientTransport {
    private let status: Int
    private let data: Data
    private let failure: URLError?
    private(set) var method: HTTPRequest.Method?
    private(set) var path: String?
    private(set) var body: Data?
    private(set) var operationID: String?
    private(set) var baseURL: URL?

    init(status: Int, data: Data) {
        self.status = status
        self.data = data
        failure = nil
    }

    init(failure: URLError) {
        status = 503
        data = Data()
        self.failure = failure
    }

    func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws -> (
        HTTPResponse, HTTPBody?
    ) {
        if let failure { throw failure }
        method = request.method
        path = request.path
        self.operationID = operationID
        self.baseURL = baseURL
        if let body { self.body = try await Data(collecting: body, upTo: 16384) }
        return (
            HTTPResponse(status: .init(code: status), headerFields: [.contentType: "application/json"]), HTTPBody(data)
        )
    }
}
