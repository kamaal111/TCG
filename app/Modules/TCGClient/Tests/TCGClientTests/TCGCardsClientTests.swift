//
//  TCGCardsClientTests.swift
//  TCGClient
//
//  Created by Kamaal M Farah on 7/20/26.
//

import Foundation
import HTTPTypes
import KamaalAuth
import OpenAPIRuntime
import Testing

@testable import TCGClient

@Suite("TCGClient Cards Tests")
struct TCGCardsClientTests {
    @Test
    func `Lists cards through the generated operation`() async throws {
        let transport = CardsRequestTransport(status: .ok, body: cardsListJSON)
        let cards = try await makeClient(transport: transport).cards.list(game: .pokemon).get()
        let request = try #require(await transport.request)

        #expect(request.method == .get)
        #expect(request.path == "/app-api/cards?game=pokemon")
        #expect(request.operationID == "get/app-api/cards")
        #expect(cards == [CardWithPrice(card: expectedCard, price: expectedPrice)])
    }

    @Test
    func `Lists repeated sets with encoded names and complete set choices`() async throws {
        let transport = CardsRequestTransport(status: .ok, body: cardsListJSON)
        let collection = try await makeClient(transport: transport).cards.list(
            game: .pokemon,
            setNames: ["Base Set", "Special, Set & + 日本語"]
        ).get()
        let request = try #require(await transport.request)
        let path = try #require(request.path)
        let url = try #require(URLComponents(string: "https://example.com\(path)"))
        let query = try #require(url.queryItems)

        #expect(query.filter { $0.name == "game" }.map(\.value) == ["pokemon"])
        #expect(query.filter { $0.name == "set_name" }.map(\.value) == ["Base Set", "Special, Set & + 日本語"])
        #expect(collection.cards == [CardWithPrice(card: expectedCard, price: expectedPrice)])
        #expect(collection.availableSetNames == ["Base Set", "Crown Zenith"])
    }

    @Test
    func `Empty set selection omits the query parameter`() async throws {
        let transport = CardsRequestTransport(status: .ok, body: cardsListJSON)
        let collection = try await makeClient(transport: transport).cards.list(game: nil, setNames: []).get()

        #expect(await transport.request?.path == "/app-api/cards")
        #expect(collection.availableSetNames == ["Base Set", "Crown Zenith"])
    }

    @Test
    func `Preserves list validation failures as status 400`() async {
        let transport = CardsRequestTransport(status: .badRequest, body: validationJSON)
        await #expect(throws: ListCardsErrors.unknown(status: 400, payload: nil, cause: nil)) {
            try await makeClient(transport: transport).cards.list(game: nil, setNames: [""]).get()
        }
    }

    @Test
    func `Maps unavailable list pricing`() async {
        let transport = CardsRequestTransport(status: .serviceUnavailable, body: errorJSON(code: "UNAVAILABLE"))
        await #expect(throws: ListCardsErrors.unavailable) {
            try await makeClient(transport: transport).cards.list(game: nil, setNames: ["Base Set"]).get()
        }
    }

    @Test
    func `Maps a missing list session to unauthorized`() async {
        let transport = CardsRequestTransport(status: .unauthorized, body: errorJSON(code: "SESSION_NOT_FOUND"))
        let result = await makeClient(transport: transport).cards.list(game: nil)

        #expect(throws: ListCardsErrors.unauthorized) { try result.get() }
    }

    @Test
    func `Preserves undocumented list statuses`() async {
        let transport = CardsRequestTransport(status: .init(code: 500), body: Data("{}".utf8))
        let result = await makeClient(transport: transport).cards.list(game: nil)

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
        #expect(card.card == expectedCard)
        #expect(card.card.notes == nil)
        #expect(card.price == expectedPrice)
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
        #expect(card.card == expectedCard)
        #expect(card.price == expectedPrice)
    }

    @Test
    func `Disambiguates missing cards from missing sessions on update`() async {
        let missingCard = CardsRequestTransport(status: .notFound, body: errorJSON(code: "CARD_NOT_FOUND"))
        let missingSession = CardsRequestTransport(status: .unauthorized, body: errorJSON(code: "SESSION_NOT_FOUND"))

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
    func `Creates purchases and decodes exact prices`() async throws {
        let input = try purchasePayload(id: nil)
        let transport = CardsRequestTransport(status: .created, body: purchaseCardJSON)
        let saved = try await makeClient(transport: transport).cards.create(with: input).get()
        let request = try #require(await transport.request)
        #expect(request.operationID == "post/app-api/cards")
        try assertPurchasePayload(request, expectedID: nil)
        try assertPurchaseResponse(saved)
    }

    @Test
    func `Updates purchases and decodes exact prices`() async throws {
        let input = try purchasePayload(id: "batch-id")
        let transport = CardsRequestTransport(status: .ok, body: purchaseCardJSON)
        let saved = try await makeClient(transport: transport).cards.update(id: "card-id", with: input).get()
        let request = try #require(await transport.request)
        #expect(request.operationID == "put/app-api/cards/{cardId}")
        try assertPurchasePayload(request, expectedID: "batch-id")
        try assertPurchaseResponse(saved)
    }

    @Test
    func `Deletion uses one generated request and decodes partial success`() async throws {
        let transport = CardsRequestTransport(
            status: .ok,
            body: Data(
                """
                {"deleted_ids":["first-card"],"not_found_ids":["missing-card"]}
                """.utf8
            )
        )
        let ids = ["first-card", "missing-card", "first-card"]
        let result = try await makeClient(transport: transport).cards.delete(ids: ids).get()
        let request = try #require(await transport.request)
        let body = try #require(request.body)

        #expect(request.method == .delete)
        #expect(request.path == "/app-api/cards")
        #expect(request.operationID == "delete/app-api/cards")
        #expect(try JSONDecoder().decode(DeleteCardsPayload.self, from: body) == DeleteCardsPayload(cardIDs: ids))
        #expect(result == DeleteCardsResult(deletedIDs: ["first-card"], notFoundIDs: ["missing-card"]))
    }

    @Test(arguments: [[], ["first-card"], ["first-card", "second-card"]])
    func `Deletion decodes full and empty success`(ids: [String]) async throws {
        let body = Data(
            """
            {"deleted_ids":\(String(decoding: try JSONEncoder().encode(ids), as: UTF8.self)),"not_found_ids":[]}
            """.utf8
        )
        let transport = CardsRequestTransport(status: .ok, body: body)
        #expect(
            try await makeClient(transport: transport).cards.delete(ids: ids).get()
                == DeleteCardsResult(deletedIDs: ids, notFoundIDs: [])
        )
    }

    @Test
    func `Deletion maps validation failures`() async {
        let transport = CardsRequestTransport(status: .badRequest, body: validationJSON)
        await #expect(throws: DeleteCardsErrors.badRequest(validations: [validationIssue])) {
            try await makeClient(transport: transport).cards.delete(ids: ["invalid"]).get()
        }
    }

    @Test
    func `Deletion maps missing sessions`() async {
        let transport = CardsRequestTransport(status: .unauthorized, body: errorJSON(code: "SESSION_NOT_FOUND"))
        await #expect(throws: DeleteCardsErrors.unauthorized) {
            try await makeClient(transport: transport).cards.delete(ids: ["first-card"]).get()
        }
    }

    @Test
    func `Deletion preserves undocumented failure statuses`() async {
        let transport = CardsRequestTransport(status: .internalServerError, body: Data("{}".utf8))
        await #expect(throws: DeleteCardsErrors.unknown(status: 500, payload: nil, cause: nil)) {
            try await makeClient(transport: transport).cards.delete(ids: ["first-card"]).get()
        }
    }

    @Test
    func `Deletion maps malformed responses`() async {
        let transport = CardsRequestTransport(status: .ok, body: Data("{}".utf8))
        await #expect(throws: DeleteCardsErrors.unknown(status: 503, payload: nil, cause: nil)) {
            try await makeClient(transport: transport).cards.delete(ids: ["first-card"]).get()
        }
    }

    @Test
    func `Deletion maps transport failures`() async {
        let transport = CardsRequestTransport(status: .ok, body: Data(), fails: true)
        await #expect(throws: DeleteCardsErrors.unknown(status: 503, payload: nil, cause: nil)) {
            try await makeClient(transport: transport).cards.delete(ids: ["first-card"]).get()
        }
    }

    private func purchasePayload(id: String?) throws -> UpsertCardPayload {
        let amount = try #require(Decimal(string: "3.123456"))
        return UpsertCardPayload(
            game: .onePiece,
            name: payload.name,
            setName: payload.setName,
            cardNumber: payload.cardNumber,
            notes: nil,
            purchases: [CardPurchase(id: id, condition: .nearMint, quantity: 2, purchasePrice: amount, currency: .usd)]
        )
    }

    private func assertPurchasePayload(_ request: CardsRecordedRequest, expectedID: String?) throws {
        let body = try #require(request.body)
        let wire = try #require(JSONSerialization.jsonObject(with: body) as? [String: Any])
        #expect(wire["quantities"] == nil)
        #expect(wire["purchase_batches"] == nil)
        let sent = try JSONDecoder().decode(Components.Schemas.UpsertCard.self, from: body)
        #expect(sent.purchases.count == 1)
        let purchase = try #require(sent.purchases.first)
        #expect(purchase.id == expectedID)
        #expect(purchase.condition.rawValue == "near_mint")
        #expect(purchase.quantity == 2)
        #expect(purchase.purchasePrice == "3.123456")
        #expect(purchase.currency?.rawValue == "USD")
    }

    private func assertPurchaseResponse(_ saved: CardWithPrice) throws {
        let amount = try #require(Decimal(string: "3.123456"))
        #expect(
            saved.card.purchases == [
                CardPurchase(
                    id: "batch-id",
                    condition: .nearMint,
                    quantity: 2,
                    purchasePrice: amount,
                    currency: .usd,
                    automaticPriceDate: "2026-10-08"
                )
            ]
        )
        #expect(saved.card.purchasePriceChangePercent == 25)
    }

    private func makeClient(transport: CardsRequestTransport) -> TCGClient {
        let credentials = Credentials(
            authToken: "auth-token",
            authTokenExpiryDate: .distantFuture,
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
    private let fails: Bool

    init(status: HTTPResponse.Status, body: Data, fails: Bool = false) {
        self.status = status
        self.body = body
        self.fails = fails
    }

    func send(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL _: URL,
        operationID: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        if fails { throw URLError(.notConnectedToInternet) }
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
    purchases: [.init(condition: .nearMint, quantity: 2)]
)

private let expectedCard = Card(
    id: "card-id",
    game: .onePiece,
    name: "Monkey D. Luffy",
    setName: "Romance Dawn",
    cardNumber: "OP01-003",
    notes: nil,
    createdAt: Date(timeIntervalSince1970: 1_784_543_400),
    updatedAt: Date(timeIntervalSince1970: 1_784_543_400),
    purchases: [.init(id: "purchase-id", condition: .nearMint, quantity: 2)]
)

private let expectedPrice = OwnedCardPrice(cardId: "card-id", status: .noPrice)

private let cardJSON = Data(
    """
    {
      "id": "card-id", "game": "one_piece", "name": "Monkey D. Luffy",
      "set_name": "Romance Dawn", "card_number": "OP01-003", "notes": null,
      "purchases": [{"id":"purchase-id","condition":"near_mint","quantity":2,"purchase_price":null,"currency":null,"automatic_price_date":null}], "purchase_price_change_percent": null,
      "created_at": "2026-07-20T10:30:00.000Z", "updated_at": "2026-07-20T10:30:00.000Z",
      "price": {"card_id": "card-id", "status": "no_price"}
    }
    """.utf8
)
private let cardsListJSON = Data(
    """
    {
      "cards": [\(String(decoding: cardJSON, as: UTF8.self))],
      "available_set_names": ["Base Set", "Crown Zenith"]
    }
    """.utf8
)
private let validationIssue = TCGClientValidationIssue(code: "too_small", path: ["name"], message: "Required")
private let validationJSON = Data(
    """
    {"message":"Invalid payload","code":"INVALID_PAYLOAD","context":{"validations":[{"code":"too_small","path":["name"],"message":"Required"}]}}
    """.utf8
)
private func errorJSON(code: String) -> Data {
    Data(
        """
        {
          "message": "Not found", "code": "\(code)"
        }
        """.utf8
    )
}

private let purchaseCardJSON = Data(
    """
    {
      "id": "card-id", "game": "one_piece", "name": "Monkey D. Luffy",
      "set_name": "Romance Dawn", "card_number": "OP01-003", "notes": null,
      "purchases": [{"id": "batch-id", "condition": "near_mint", "quantity": 2,
        "purchase_price": "3.123456", "currency": "USD", "automatic_price_date": "2026-10-08"}],
      "purchase_price_change_percent": 25,
      "created_at": "2026-07-20T10:30:00.000Z", "updated_at": "2026-07-20T10:30:00.000Z",
      "price": {"card_id": "card-id", "status": "no_price"}
    }
    """.utf8
)
