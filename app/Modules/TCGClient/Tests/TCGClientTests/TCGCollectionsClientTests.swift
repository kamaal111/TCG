import Foundation
import HTTPTypes
import OpenAPIRuntime
import Testing

@testable import TCGClient

struct TCGCollectionsClientTests {
    @Test func `Loads page cards without redundant layout metadata`() async throws {
        let transport = CollectionTransport(status: .ok, response: Data("{\"cards\":[]}".utf8))
        let client = makeClient(transport)
        let page = try await client.page(
            collectionID: ClientTestIDs.collection,
            pageID: ClientTestIDs.page
        )
        .get()
        #expect(page.cards.isEmpty)
        let request = try #require(await transport.request)
        #expect(request.method == .get)
        #expect(
            request.path
                == "/app-api/collections/00000000-0000-4000-8000-000000000040/pages/00000000-0000-4000-8000-000000000041"
        )
        #expect(await transport.operationID == "get/app-api/collections/{collectionId}/pages/{pageId}")
    }

    @Test func `Loads only the selected collection layout`() async throws {
        var collection = Self.emptyCollection
        collection.pages = [.init(id: ClientTestIDs.page, slots: [])]
        let transport = CollectionTransport(status: .ok, response: try JSONEncoder().encode(collection))
        let result = try await makeClient(transport).get(id: collection.id).get()
        #expect(result == collection)
        let request = try #require(await transport.request)
        #expect(request.method == .get)
        #expect(request.path == "/app-api/collections/00000000-0000-4000-8000-000000000001")
        #expect(await transport.operationID == "get/app-api/collections/{collectionId}")
    }

    @Test func `Saves rectangular dimensions and split quantities through the generated layout operation`() async throws
    {
        var collection = Self.emptyCollection
        collection.columns = 1
        collection.rows = 4
        collection.revision = 2
        collection.pages = [
            .init(
                id: ClientTestIDs.secondary,
                slots: [
                    .init(
                        row: 1,
                        column: 1,
                        cardID: ClientTestIDs.third,
                        quantity: 3
                    ),
                    .init(
                        row: 2,
                        column: 1,
                        cardID: ClientTestIDs.third,
                        quantity: 1
                    ),
                ]
            ), .init(id: ClientTestIDs.fourth, slots: []),
        ]
        let transport = CollectionTransport(status: .ok, response: try JSONEncoder().encode(collection))
        let saved = try await makeClient(transport).save(collection).get()
        #expect(saved == collection)
        let request = try #require(await transport.request)
        #expect(request.method == .put)
        #expect(request.path == "/app-api/collections/00000000-0000-4000-8000-000000000001/layout")
        #expect(await transport.operationID == "put/app-api/collections/{collectionId}/layout")
        let body = try #require(await transport.body)
        let payload = try JSONDecoder().decode(Components.Schemas.SaveBinderLayout.self, from: body)
        #expect(payload.value1.columns == 1)
        #expect(payload.value1.rows == 4)
        #expect(payload.value2.revision == 2)
        #expect(payload.value1.pages.map(\.id) == collection.pages.map { UUIDCoding.encode($0.id) })
        #expect(payload.value1.pages.map { $0.slots.map(\.quantity) } == [[3, 1], []])
    }

    @Test func `Renames a collection with its current revision through the generated update operation`() async throws {
        var collection = Self.emptyCollection
        collection.name = "Renamed"
        collection.revision = 2
        let transport = CollectionTransport(status: .ok, response: try JSONEncoder().encode(collection))
        let result = try await makeClient(transport).update(collection).get()
        #expect(result == collection)
        let request = try #require(await transport.request)
        #expect(request.method == .patch)
        #expect(request.path == "/app-api/collections/00000000-0000-4000-8000-000000000001")
        let body = try #require(await transport.body)
        let payload = try JSONDecoder().decode(Components.Schemas.UpdateCollection.self, from: body)
        #expect(payload.value1.name == collection.name)
        #expect(payload.value2.revision == collection.revision)
    }

    @Test(arguments: [
        (HTTPResponse.Status.unauthorized, CollectionsError.unauthorized), (.notFound, .notFound),
        (.conflict, .conflict), (.internalServerError, .unavailable),
        (.contentTooLarge, .requestTooLarge), (.requestTimeout, .timedOut), (.tooManyRequests, .busy),
    ])
    func `Maps documented collection failures`(failure: (HTTPResponse.Status, CollectionsError)) async throws {
        let transport = CollectionTransport(
            status: failure.0,
            response: Data("{\"message\":\"Rejected\",\"code\":\"COLLECTION_CONFLICT\"}".utf8)
        )
        let client = makeClient(transport)
        await #expect(throws: failure.1) { try await client.list().get() }
    }

    @Test func `Export selection preserves cards purchases fractional dates and empty pages`() async throws {
        var collection = Self.emptyCollection
        collection.name = "Empty"
        collection.columns = 4
        collection.rows = 1
        collection.pages = [.init(id: ClientTestIDs.secondary, slots: [])]
        let backup = makeBackup(collection: collection)
        let transport = CollectionTransport(status: .ok, response: try CollectionBackupCoding.encode(backup).get())
        let client = makeClient(transport)
        let result = try await client.export(ids: [collection.id]).get()
        #expect(result.collections == [collection])
        #expect(result.cards == backup.cards)
        let body = try #require(await transport.body)
        #expect(
            try JSONDecoder().decode(Components.Schemas.ExportCollections.self, from: body).collectionIds == [
                collection.id.uuidString.lowercased()
            ]
        )
        #expect(await transport.operationID == "post/app-api/collections/export")
    }

    @Test(arguments: [
        ("COLLECTION_BUSY", CollectionsError.busy),
        ("COLLECTION_OPERATION_TIMEOUT", .timedOut),
        ("UNEXPECTED", .unavailable),
    ])
    func `Maps service failures by their documented code`(failure: (String, CollectionsError)) async throws {
        let response = """
            {"message":"Rejected","code":"\(failure.0)"}
            """
        let client = makeClient(CollectionTransport(status: .serviceUnavailable, response: Data(response.utf8)))
        await #expect(throws: failure.1) {
            try await client.preview(.init(version: 1, collections: [], cards: [])).get()
        }
    }

    @Test func `Exporting all collections omits the explicit ID list`() async throws {
        let backup = CollectionBackup(version: 1, collections: [Self.emptyCollection], cards: [])
        let transport = CollectionTransport(status: .ok, response: try CollectionBackupCoding.encode(backup).get())
        let result = try await makeClient(transport).export(ids: nil).get()
        #expect(result.collections == backup.collections)
        let body = try #require(await transport.body)
        #expect(try JSONDecoder().decode(Components.Schemas.ExportCollections.self, from: body).collectionIds == nil)
    }

    @Test func `An interrupted export produces no backup`() async throws {
        let transport = CollectionTransport(
            status: .ok,
            response: Data(#"{"version":1,"collections":[],"cards":[]"#.utf8)
        )
        await #expect(throws: CollectionsError.unavailable) { try await makeClient(transport).export(ids: nil).get() }
    }

    @Test func `Preview sends complete typed backup cards and layouts`() async throws {
        let backup = makeBackup(collection: Self.emptyCollection)
        let response = Data(
            #"{"new_collection_count":1,"updated_collection_count":0,"new_card_count":1,"updated_card_count":0,"moved_card_count":0}"#
                .utf8
        )
        let transport = CollectionTransport(status: .ok, response: response)
        let result = try await makeClient(transport).preview(backup).get()
        #expect(result.newCollectionCount == 1)
        #expect(result.newCardCount == 1)
        let body = try #require(await transport.body)
        let sent = try CollectionBackupCoding.decode(body).get()
        #expect(sent.collections == backup.collections)
        #expect(sent.cards == backup.cards)
    }

    private func makeBackup(collection: CardBinderCollection) -> CollectionBackup {
        var card = ImportCardPayload(
            card: ClientCardFixtures.card(
                id: ClientTestIDs.third,
                createdAt: Date(timeIntervalSince1970: 1_750_000_000.125)
            )
        )
        card.collectionID = collection.id
        return CollectionBackup(version: CollectionBackup.currentVersion, collections: [collection], cards: [card])
    }

    private func makeClient(_ transport: CollectionTransport) -> TCGCollectionsClientImpl {
        TCGCollectionsClientImpl(
            client: Client(
                serverURL: Self.serverURL,
                configuration: .init(dateTranscoder: .iso8601WithFractionalSeconds),
                transport: transport
            )
        )
    }

    private static let emptyCollection = CardBinderCollection(
        id: ClientTestIDs.primary,
        name: "Favorites",
        isUnfiled: false,
        columns: 3,
        rows: 3,
        revision: 0,
        pages: []
    )

    private static let serverURL = URL(string: "https://example.com")!

}

private actor CollectionTransport: ClientTransport {
    let status: HTTPResponse.Status
    let response: Data
    var request: HTTPRequest?
    var body: Data?
    var operationID: String?

    init(status: HTTPResponse.Status, response: Data) {
        self.status = status
        self.response = response
    }

    func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws -> (
        HTTPResponse, HTTPBody?
    ) {
        self.request = request
        self.operationID = operationID
        if let body { self.body = try await Data(collecting: body, upTo: .max) }
        let chunks = AsyncStream<ArraySlice<UInt8>> { continuation in
            for byte in response { continuation.yield([byte]) }
            continuation.finish()
        }
        return (
            HTTPResponse(status: status, headerFields: [.contentType: "application/json"]),
            HTTPBody(chunks, length: .unknown)
        )
    }
}
