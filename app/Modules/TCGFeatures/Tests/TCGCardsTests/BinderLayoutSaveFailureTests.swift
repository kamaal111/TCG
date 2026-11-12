import Foundation
import HTTPTypes
import KamaalAuth
import OpenAPIRuntime
import Testing

@testable import TCGCards
@testable import TCGClient

@MainActor
struct BinderLayoutSaveFailureTests {
    @Test(arguments: [LayoutSaveFailure.conflict, .network])
    func `Failed layout save preserves the selected binder and exposes its mapped error`(failure: LayoutSaveFailure)
        async throws
    {
        let original = CollectionTestFixtures.binder(columns: 2, rows: 2)
        let transport = LayoutFailureTransport(collection: original, failure: failure)
        let credentials = Credentials(
            authToken: "auth-token",
            authTokenExpiryDate: .distantFuture,
            sessionToken: "session-token",
            sessionUpdateAge: 1800,
            lastSessionUpdate: .now
        )
        let client = TCGClient.default(
            transport: transport,
            credentialsKeychainKey: "binder-layout-tests",
            credentialsStore: InMemoryCredentialsStore(seed: try JSONEncoder().encode(credentials))
        )
        let cards = TCGCards(client: .preview())
        let collections = TCGCollections(client: client, defaults: nil)
        await collections.reload(using: cards)
        await collections.select(original.id, using: cards)
        #expect(collections.selected == original)
        let updated = try #require(
            BinderLayout.insertingEmptyPage(in: original, before: CardsTestIDs.secondary, pageID: CardsTestIDs.third)
        )
        #expect(!(await collections.save(updated, using: cards)))
        #expect(collections.selected == original)
        #expect(collections.error == failure.expectedError)
        #expect(!collections.isWorking)
        #expect(await transport.saveCount == 1)
    }
}

enum LayoutSaveFailure: Sendable {
    case conflict
    case network

    var expectedError: CollectionsError {
        switch self {
        case .conflict: .conflict
        case .network: .unavailable
        }
    }
}

private actor LayoutFailureTransport: ClientTransport {
    let collection: CardBinderCollection
    let failure: LayoutSaveFailure
    private(set) var saveCount = 0

    init(collection: CardBinderCollection, failure: LayoutSaveFailure) {
        self.collection = collection
        self.failure = failure
    }

    func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws -> (
        HTTPResponse, HTTPBody?
    ) {
        if request.method == .put {
            saveCount += 1
            switch failure {
            case .network: throw URLError(.notConnectedToInternet)
            case .conflict:
                return (
                    HTTPResponse(status: .conflict, headerFields: [.contentType: "application/json"]),
                    HTTPBody(
                        """
                        {"message":"Collection changed","code":"LAYOUT_CONFLICT"}
                        """
                    )
                )
            }
        }
        let encoder = JSONEncoder()
        let data: Data
        if request.path?.hasSuffix("/collections") == true {
            data = try encoder.encode(["collections": [collection.summary]])
        } else {
            data = try encoder.encode(collection)
        }
        return (HTTPResponse(status: .ok, headerFields: [.contentType: "application/json"]), HTTPBody(data))
    }
}
