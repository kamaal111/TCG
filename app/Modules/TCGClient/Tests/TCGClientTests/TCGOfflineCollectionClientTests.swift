import Foundation
import HTTPTypes
import OpenAPIRuntime
import Testing

@testable import TCGClient

struct TCGOfflineCollectionClientTests {
    @Test func `Sends the previous ETag and accepts a bodyless 304`() async throws {
        let transport = OfflineTransport(status: .notModified, response: nil)
        let client = makeClient(transport)

        let result = try await client.manifest(etag: "\"previous\"")

        #expect(result == nil)
        let request = try #require(await transport.request)
        #expect(request.method == .get)
        #expect(request.path == "/app-api/cards/offline/manifest")
        #expect(request.headerFields[.ifNoneMatch] == "\"previous\"")
    }

    @Test func `Decodes the server account and sends only selected manifest entries`() async throws {
        let manifestBody = """
            {
              "version": 1,
              "account_id": "owner-id",
              "entries": [
                {"kind": "card", "id": "00000000-0000-4000-8000-000000000001",
                 "hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}
              ],
              "needs_preparation": []
            }
            """
        let manifestClient = makeClient(OfflineTransport(status: .ok, response: manifestBody))
        let received = try await manifestClient.manifest(etag: nil)
        let manifest = try #require(received)
        #expect(manifest.etag == "\"current\"")
        #expect(manifest.accountID == "owner-id")
        #expect(manifest.entries.map(\.id) == [ClientTestIDs.primary])

        let recordsTransport = OfflineTransport(
            status: .ok,
            response: """
                {"cards": [], "collections": []}
                """
        )
        let records = try await makeClient(recordsTransport).records(manifest.entries)

        #expect(records.cards.isEmpty)
        #expect(records.collections.isEmpty)
        let request = try #require(await recordsTransport.request)
        #expect(request.method == .post)
        #expect(request.path == "/app-api/cards/offline/records")
        let body = try #require(await recordsTransport.body)
        let payload = try JSONDecoder()
            .decode(
                Operations.GetOfflineCollectionRecords.Input.Body.JsonPayload.self,
                from: body
            )
        #expect(payload.entries.map(\.id) == [UUIDCoding.encode(ClientTestIDs.primary)])
        #expect(payload.entries.map(\.hash) == manifest.entries.map(\.hash))
    }

    @Test func `Maps a stale record request to a refreshable conflict`() async throws {
        let client = makeClient(
            OfflineTransport(
                status: .conflict,
                response: """
                    {"message": "Changed", "code": "OFFLINE_COLLECTION_CHANGED"}
                    """
            )
        )

        await #expect(throws: OfflineCollectionError.changed) { try await client.records([]) }
    }

    private func makeClient(_ transport: OfflineTransport) -> TCGOfflineCollectionClient {
        TCGOfflineCollectionClient(
            client: Client(
                serverURL: URL(filePath: "/"),
                transport: transport,
                middlewares: [OfflineManifestETagMiddleware()]
            )
        )
    }
}

private actor OfflineTransport: ClientTransport {
    let status: HTTPResponse.Status
    let response: String?
    var request: HTTPRequest?
    var body: Data?

    init(status: HTTPResponse.Status, response: String?) {
        self.status = status
        self.response = response
    }

    func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws -> (
        HTTPResponse, HTTPBody?
    ) {
        self.request = request
        if let body { self.body = try await Data(collecting: body, upTo: 10_000) }
        return (
            HTTPResponse(status: status, headerFields: [.contentType: "application/json", .eTag: "\"current\""]),
            response.map { HTTPBody($0) }
        )
    }
}
