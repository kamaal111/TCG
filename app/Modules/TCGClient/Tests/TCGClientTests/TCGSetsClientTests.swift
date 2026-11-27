import Foundation
import HTTPTypes
import OpenAPIRuntime
import Testing

@testable import TCGClient

struct TCGSetsClientTests {
    @Test
    func `Checklist request sends filters and cursor and decodes ownership`() async throws {
        let transport = SetsRequestTransport(
            status: .ok,
            json: """
                {
                    "entries": [{"number":"2","printed_number":"002/295","name":"Ivysaur","owned":false}],
                    "next_cursor": "next",
                    "set": {"id":"me2pt5","name":"Ascended Heroes","collected":184,"total":295}
                }
                """
        )
        let client = try TCGSetsClientImpl(
            client: Client(
                serverURL: #require(URL(string: "https://example.com")),
                transport: transport
            )
        )
        let page = try await client.checklist(game: .pokemon, setID: "me2pt5", filter: .missing, cursor: "first").get()
        let request = try #require(await transport.request)
        #expect(request.method == .get)
        #expect(request.path == "/app-api/sets/pokemon/me2pt5/cards?filter=missing&cursor=first")
        #expect(await transport.operationID == "getAppApiSetChecklist")
        #expect(page.set.progress == .init(collected: 184, total: 295))
        #expect(page.cards.nextCursor == "next")
        #expect(page.cards.entries.first?.owned == false)
    }

    @Test
    func `Catalog rejects unauthenticated requests`() async throws {
        let transport = SetsRequestTransport(
            status: .unauthorized,
            json: #"{"message":"Unauthorized","code":"UNAUTHORIZED"}"#
        )
        let client = try TCGSetsClientImpl(
            client: Client(
                serverURL: #require(URL(string: "https://example.com")),
                transport: transport
            )
        )
        let result = await client.list(game: .onePiece, query: nil, inProgress: false, cursor: nil)
        #expect(throws: CatalogSetsError.unauthorized) { try result.get() }
    }
}

private actor SetsRequestTransport: ClientTransport {
    let status: HTTPResponse.Status
    let json: String
    private(set) var request: HTTPRequest?
    private(set) var operationID: String?

    init(status: HTTPResponse.Status, json: String) {
        self.status = status
        self.json = json
    }

    func send(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        self.request = request
        self.operationID = operationID
        return (HTTPResponse(status: status, headerFields: [.contentType: "application/json"]), HTTPBody(json))
    }
}
