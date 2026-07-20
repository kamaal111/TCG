//
//  TCGCardsClientTests.swift
//  TCGClient
//
//  Created by Kamaal M Farah on 7/20/26.
//

import Foundation
import HTTPTypes
import OpenAPIRuntime
import Testing

@testable import TCGClient

@Suite("TCGClient Cards Tests")
struct TCGCardsClientTests {
    @Test
    func `Lists cards through the generated operation`() async throws {
        let transport = CardsRequestTransport(status: .ok, body: cardsListJSON)
        let cards = try await makeClient(transport: transport).cards.list().get()
        let request = try #require(await transport.request)

        #expect(request.method == .get)
        #expect(request.path == "/app-api/cards")
        #expect(request.operationID == "get/app-api/cards")
        #expect(cards == [expectedCard])
    }

    @Test
    func `Maps a missing list session to unauthorized`() async {
        let transport = CardsRequestTransport(status: .notFound, body: errorJSON(code: "SESSION_NOT_FOUND"))
        let result = await makeClient(transport: transport).cards.list()

        #expect(throws: ListCardsErrors.unauthorized) { try result.get() }
    }

    @Test
    func `Preserves undocumented list statuses`() async {
        let transport = CardsRequestTransport(status: .init(code: 500), body: Data("{}".utf8))
        let result = await makeClient(transport: transport).cards.list()

        await #expect(throws: ListCardsErrors.unknown(status: 500, payload: nil, cause: nil)) {
            try result.get()
        }
    }

    @Test
    func `Creates a card with a snake case payload`() async throws {
        let transport = CardsRequestTransport(status: .created, body: cardJSON)
        let card = try await makeClient(transport: transport).cards.create(with: payload).get()
        let request = try #require(await transport.request)
        let body = try #require(request.body)

        #expect(request.method == .post)
        #expect(request.path == "/app-api/cards")
        #expect(request.operationID == "post/app-api/cards")
        #expect(try JSONDecoder().decode(UpsertCardPayload.self, from: body) == payload)
        #expect(card == expectedCard)
        #expect(card.notes == nil)
    }

    @Test
    func `Maps create validation errors`() async {
        let transport = CardsRequestTransport(status: .badRequest, body: validationJSON)
        let result = await makeClient(transport: transport).cards.create(with: payload)

        #expect(throws: CreateCardErrors.badRequest(validations: [validationIssue])) {
            try result.get()
        }
    }

    @Test
    func `Updates a card and encodes the path identifier`() async throws {
        let transport = CardsRequestTransport(status: .ok, body: cardJSON)
        let card = try await makeClient(transport: transport).cards.update(id: "card-id", with: payload).get()
        let request = try #require(await transport.request)

        #expect(request.method == .put)
        #expect(request.path == "/app-api/cards/card-id")
        #expect(request.operationID == "put/app-api/cards/{cardId}")
        #expect(card == expectedCard)
    }

    @Test
    func `Disambiguates missing cards from missing sessions on update`() async {
        let missingCard = CardsRequestTransport(status: .notFound, body: errorJSON(code: "CARD_NOT_FOUND"))
        let missingSession = CardsRequestTransport(status: .notFound, body: errorJSON(code: "SESSION_NOT_FOUND"))

        await #expect(throws: UpdateCardErrors.notFound) {
            try await makeClient(transport: missingCard).cards.update(id: "card-id", with: payload).get()
        }
        await #expect(throws: UpdateCardErrors.unauthorized) {
            try await makeClient(transport: missingSession).cards.update(id: "card-id", with: payload).get()
        }
    }

    @Test
    func `Maps update validation errors`() async {
        let transport = CardsRequestTransport(status: .badRequest, body: validationJSON)

        await #expect(throws: UpdateCardErrors.badRequest(validations: [validationIssue])) {
            try await makeClient(transport: transport).cards.update(id: "card-id", with: payload).get()
        }
    }

    @Test
    func `Deletes a card through the generated operation`() async throws {
        let transport = CardsRequestTransport(status: .ok, body: Data("{}".utf8))
        _ = try await makeClient(transport: transport).cards.delete(id: "card-id").get()
        let request = try #require(await transport.request)

        #expect(request.method == .delete)
        #expect(request.path == "/app-api/cards/card-id")
        #expect(request.operationID == "delete/app-api/cards/{cardId}")
    }

    @Test
    func `Maps a missing card on delete`() async {
        let transport = CardsRequestTransport(status: .notFound, body: errorJSON(code: "CARD_NOT_FOUND"))

        await #expect(throws: DeleteCardErrors.notFound) {
            try await makeClient(transport: transport).cards.delete(id: "card-id").get()
        }
    }

    private func makeClient(transport: CardsRequestTransport) -> TCGClient {
        let credentials = Credentials(
            authToken: "auth-token",
            expiryDate: .distantFuture,
            sessionToken: "session-token",
            sessionUpdateAge: 1800,
            lastSessionUpdate: .now
        )
        return TCGClient.default(
            transport: transport,
            credentialsKeychainKey: "cards-test-credentials",
            credentialsStore: InMemoryCredentialsStore(seed: try? JSONEncoder().encode(credentials))
        )
    }
}

private actor CardsRequestTransport: ClientTransport {
    private(set) var request: CardsRecordedRequest?
    private let status: HTTPResponse.Status
    private let body: Data

    init(status: HTTPResponse.Status, body: Data) {
        self.status = status
        self.body = body
    }

    func send(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL _: URL,
        operationID: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        let bodyData: Data?
        if let body {
            bodyData = try await Data(collecting: body, upTo: .max)
        } else {
            bodyData = nil
        }
        self.request = CardsRecordedRequest(
            method: request.method,
            path: request.path,
            operationID: operationID,
            body: bodyData
        )
        return (
            HTTPResponse(status: status, headerFields: [.contentType: "application/json"]),
            HTTPBody(self.body)
        )
    }
}

private struct CardsRecordedRequest: Sendable {
    let method: HTTPRequest.Method
    let path: String?
    let operationID: String
    let body: Data?
}

private let payload = UpsertCardPayload(
    game: .onePiece,
    name: "Monkey D. Luffy",
    setName: "Romance Dawn",
    cardNumber: "OP01-003",
    notes: nil,
    quantities: [.init(condition: .nearMint, quantity: 2)]
)

private let expectedCard = Card(
    id: "card-id",
    game: .onePiece,
    name: "Monkey D. Luffy",
    setName: "Romance Dawn",
    cardNumber: "OP01-003",
    notes: nil,
    quantities: [.init(condition: .nearMint, quantity: 2)],
    createdAt: Date(timeIntervalSince1970: 1_784_543_400),
    updatedAt: Date(timeIntervalSince1970: 1_784_543_400)
)

private let cardJSON = Data(
    """
    {
      "id": "card-id", "game": "one_piece", "name": "Monkey D. Luffy",
      "set_name": "Romance Dawn", "card_number": "OP01-003", "notes": null,
      "quantities": [{"condition": "near_mint", "quantity": 2}],
      "created_at": "2026-07-20T10:30:00.000Z", "updated_at": "2026-07-20T10:30:00.000Z"
    }
    """.utf8
)
private let cardsListJSON = Data("{\"cards\":[\(String(decoding: cardJSON, as: UTF8.self))]}".utf8)
private let validationIssue = TCGClientValidationIssue(code: "too_small", path: ["name"], message: "Required")
private let validationJSON = Data(
    """
    {"message":"Invalid payload","code":"INVALID_PAYLOAD","context":{"validations":[{"code":"too_small","path":["name"],"message":"Required"}]}}
    """.utf8
)
private func errorJSON(code: String) -> Data {
    Data("{\"message\":\"Not found\",\"code\":\"\(code)\"}".utf8)
}
