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
    func `Should list cards and decode the populated response`() async throws {
        let transport = CardsRequestTransport.listSuccess()
        let client = makeClient(transport: transport)

        let cards = try await client.cards.list().get()

        try await assertRequest(in: transport, method: .get, path: "/app-api/cards", operationID: "get/app-api/cards")
        #expect(cards.count == 2)
        let onePieceCard = try #require(cards.first)
        #expect(onePieceCard.id == "card-1")
        #expect(onePieceCard.game == .onePiece)
        #expect(onePieceCard.name == "Monkey D. Luffy")
        #expect(onePieceCard.setName == "Romance Dawn")
        #expect(onePieceCard.cardNumber == "OP01-003")
        #expect(onePieceCard.notes == nil)
        #expect(
            onePieceCard.quantities == [
                CardConditionQuantity(condition: .nearMint, quantity: 2),
                CardConditionQuantity(condition: .played, quantity: 1),
            ]
        )
        #expect(onePieceCard.createdAt == date("2026-07-12T12:00:00.000Z"))
        #expect(onePieceCard.updatedAt == date("2026-07-13T12:00:00.000Z"))
        let pokemonCard = try #require(cards.last)
        #expect(pokemonCard.game == .pokemon)
        #expect(pokemonCard.notes == "First edition")
    }

    @Test
    func `Should map a session not-found list response to unauthorized`() async throws {
        let client = makeClient(transport: CardsRequestTransport.sessionNotFound())

        let result = await client.cards.list()

        try #require(throws: ListCardsErrors.unauthorized) {
            try result.get()
        }
    }

    @Test
    func `Should preserve undocumented list response statuses`() async throws {
        let client = makeClient(transport: CardsRequestTransport.undocumented())

        let result = await client.cards.list()

        try #require(throws: ListCardsErrors.unknown(status: 500, payload: nil, cause: nil)) {
            try result.get()
        }
    }

    @Test
    func `Should create a card with a correctly encoded body`() async throws {
        let transport = CardsRequestTransport.createSuccess()
        let client = makeClient(transport: transport)
        let payload = UpsertCardPayload(
            game: .onePiece,
            name: "Monkey D. Luffy",
            setName: "Romance Dawn",
            cardNumber: "OP01-003",
            notes: nil,
            quantities: [
                CardConditionQuantity(condition: .nearMint, quantity: 2),
                CardConditionQuantity(condition: .played, quantity: 1),
            ]
        )

        let card = try await client.cards.create(with: payload).get()

        try await assertRequest(in: transport, method: .post, path: "/app-api/cards", operationID: "post/app-api/cards")
        let recordedRequest = try #require(await transport.request)
        let requestBody = try #require(recordedRequest.body)
        let decodedPayload = try JSONDecoder().decode(UpsertCardPayload.self, from: requestBody)
        #expect(decodedPayload == payload)
        let rawBody = try #require(String(data: requestBody, encoding: .utf8))
        #expect(rawBody.contains("\"set_name\""))
        #expect(rawBody.contains("\"card_number\""))
        #expect(card.id == "card-1")
        #expect(card.notes == nil)
    }

    @Test
    func `Should map a create validation error to bad request with parsed issues`() async throws {
        let client = makeClient(transport: CardsRequestTransport.validationError())

        let result = await client.cards.create(
            with: UpsertCardPayload(
                game: .onePiece,
                name: "",
                setName: "Romance Dawn",
                cardNumber: "OP01-003",
                notes: nil,
                quantities: [CardConditionQuantity(condition: .nearMint, quantity: 1)]
            )
        )

        try #require(
            throws: CreateCardErrors.badRequest(
                validations: [TCGClientValidationIssue(code: "too_small", path: ["name"], message: "Name is required")]
            )
        ) {
            try result.get()
        }
    }

    @Test
    func `Should update a card through the id path and decode the replaced card`() async throws {
        let transport = CardsRequestTransport.updateSuccess()
        let client = makeClient(transport: transport)
        let payload = UpsertCardPayload(
            game: .pokemon,
            name: "Pikachu",
            setName: "Base Set",
            cardNumber: "58/102",
            notes: "First edition",
            quantities: [CardConditionQuantity(condition: .mint, quantity: 1)]
        )

        let card = try await client.cards.update(id: "card-1", with: payload).get()

        try await assertRequest(
            in: transport,
            method: .put,
            path: "/app-api/cards/card-1",
            operationID: "put/app-api/cards/{cardId}"
        )
        let recordedRequest = try #require(await transport.request)
        let requestBody = try #require(recordedRequest.body)
        let decodedPayload = try JSONDecoder().decode(UpsertCardPayload.self, from: requestBody)
        #expect(decodedPayload == payload)
        #expect(card.name == "Pikachu")
        #expect(card.notes == "First edition")
        #expect(card.quantities == [CardConditionQuantity(condition: .mint, quantity: 1)])
    }

    @Test
    func `Should map a card not-found update response to not found`() async throws {
        let client = makeClient(transport: CardsRequestTransport.cardNotFound())

        let result = await client.cards.update(id: "missing-card", with: makeUpdatePayload())

        try #require(throws: UpdateCardErrors.notFound) {
            try result.get()
        }
    }

    @Test
    func `Should map a session not-found update response to unauthorized`() async throws {
        let client = makeClient(transport: CardsRequestTransport.sessionNotFound())

        let result = await client.cards.update(id: "card-1", with: makeUpdatePayload())

        try #require(throws: UpdateCardErrors.unauthorized) {
            try result.get()
        }
    }

    @Test
    func `Should map an update validation error to bad request`() async throws {
        let client = makeClient(transport: CardsRequestTransport.validationError())

        let result = await client.cards.update(id: "card-1", with: makeUpdatePayload())

        try #require(
            throws: UpdateCardErrors.badRequest(
                validations: [TCGClientValidationIssue(code: "too_small", path: ["name"], message: "Name is required")]
            )
        ) {
            try result.get()
        }
    }

    @Test
    func `Should delete a card through the id path`() async throws {
        let transport = CardsRequestTransport.deleteSuccess()
        let client = makeClient(transport: transport)

        try await client.cards.delete(id: "card-1").get()

        try await assertRequest(
            in: transport,
            method: .delete,
            path: "/app-api/cards/card-1",
            operationID: "delete/app-api/cards/{cardId}"
        )
    }

    @Test
    func `Should map a card not-found delete response to not found`() async throws {
        let client = makeClient(transport: CardsRequestTransport.cardNotFound())

        let result = await client.cards.delete(id: "missing-card")

        try #require(throws: DeleteCardErrors.notFound) {
            try result.get()
        }
    }

    @Test
    func `Should map a transport failure to an unknown error`() async throws {
        let client = makeClient(transport: CardsRequestTransport.failing())

        let result = await client.cards.list()

        try #require(throws: ListCardsErrors.unknown(status: 503, payload: nil, cause: nil)) {
            try result.get()
        }
    }

    private func makeClient(transport: any ClientTransport) -> TCGClient {
        let credentials = Credentials(
            authToken: "auth-token",
            expiryDate: .distantFuture,
            sessionToken: "session-token",
            sessionUpdateAge: 1800,
            lastSessionUpdate: .now
        )
        let credentialsStore = InMemoryCredentialsStore(seed: try? JSONEncoder().encode(credentials))

        return TCGClient.default(
            transport: transport,
            credentialsKeychainKey: "credentials-key",
            credentialsStore: credentialsStore
        )
    }

    private func makeUpdatePayload() -> UpsertCardPayload {
        UpsertCardPayload(
            game: .onePiece,
            name: "Monkey D. Luffy",
            setName: "Romance Dawn",
            cardNumber: "OP01-003",
            notes: nil,
            quantities: [CardConditionQuantity(condition: .nearMint, quantity: 1)]
        )
    }

    private func date(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value)
    }

    private func assertRequest(
        in transport: CardsRequestTransport,
        method: HTTPRequest.Method,
        path: String,
        operationID: String
    ) async throws {
        let recordedRequest = try #require(await transport.request)
        #expect(recordedRequest.method == method)
        #expect(recordedRequest.path == path)
        #expect(recordedRequest.operationID == operationID)
        #expect(recordedRequest.authorization == "Bearer auth-token")
    }
}

private actor CardsRequestTransport: ClientTransport {
    private(set) var requests: [RecordedCardsRequest] = []
    private let response: HTTPResponse?
    private let responseBody: Data?

    private init(response: HTTPResponse?, responseBody: Data?) {
        self.response = response
        self.responseBody = responseBody
    }

    var request: RecordedCardsRequest? {
        requests.last
    }

    static func listSuccess() -> CardsRequestTransport {
        CardsRequestTransport(
            response: .init(status: .ok, headerFields: [.contentType: "application/json"]),
            responseBody: Data(
                """
                {
                  "cards": [
                    {
                      "id": "card-1",
                      "game": "one_piece",
                      "name": "Monkey D. Luffy",
                      "set_name": "Romance Dawn",
                      "card_number": "OP01-003",
                      "notes": null,
                      "quantities": [
                        { "condition": "near_mint", "quantity": 2 },
                        { "condition": "played", "quantity": 1 }
                      ],
                      "created_at": "2026-07-12T12:00:00.000Z",
                      "updated_at": "2026-07-13T12:00:00.000Z"
                    },
                    {
                      "id": "card-2",
                      "game": "pokemon",
                      "name": "Pikachu",
                      "set_name": "Base Set",
                      "card_number": "58/102",
                      "notes": "First edition",
                      "quantities": [{ "condition": "mint", "quantity": 1 }],
                      "created_at": "2026-07-11T12:00:00.000Z",
                      "updated_at": "2026-07-11T12:00:00.000Z"
                    }
                  ]
                }
                """.utf8)
        )
    }

    static func createSuccess() -> CardsRequestTransport {
        CardsRequestTransport(
            response: .init(status: .created, headerFields: [.contentType: "application/json"]),
            responseBody: singleCardBody()
        )
    }

    static func updateSuccess() -> CardsRequestTransport {
        CardsRequestTransport(
            response: .init(status: .ok, headerFields: [.contentType: "application/json"]),
            responseBody: Data(
                """
                {
                  "id": "card-1",
                  "game": "pokemon",
                  "name": "Pikachu",
                  "set_name": "Base Set",
                  "card_number": "58/102",
                  "notes": "First edition",
                  "quantities": [{ "condition": "mint", "quantity": 1 }],
                  "created_at": "2026-07-12T12:00:00.000Z",
                  "updated_at": "2026-07-13T12:00:00.000Z"
                }
                """.utf8)
        )
    }

    static func deleteSuccess() -> CardsRequestTransport {
        CardsRequestTransport(
            response: .init(status: .ok, headerFields: [.contentType: "application/json"]),
            responseBody: Data("{}".utf8)
        )
    }

    static func validationError() -> CardsRequestTransport {
        CardsRequestTransport(
            response: .init(status: .badRequest, headerFields: [.contentType: "application/json"]),
            responseBody: Data(
                """
                {
                  "message": "Invalid payload",
                  "code": "INVALID_PAYLOAD",
                  "context": {
                    "validations": [
                      {
                        "code": "too_small",
                        "path": ["name"],
                        "message": "Name is required"
                      }
                    ]
                  }
                }
                """.utf8)
        )
    }

    static func sessionNotFound() -> CardsRequestTransport {
        CardsRequestTransport(
            response: .init(status: .notFound, headerFields: [.contentType: "application/json"]),
            responseBody: Data("{ \"message\": \"Not found\", \"code\": \"NOT_FOUND\" }".utf8)
        )
    }

    static func cardNotFound() -> CardsRequestTransport {
        CardsRequestTransport(
            response: .init(status: .notFound, headerFields: [.contentType: "application/json"]),
            responseBody: Data("{ \"message\": \"Card not found\", \"code\": \"CARD_NOT_FOUND\" }".utf8)
        )
    }

    static func undocumented() -> CardsRequestTransport {
        CardsRequestTransport(
            response: .init(status: .internalServerError, headerFields: [.contentType: "application/json"]),
            responseBody: Data("{}".utf8)
        )
    }

    static func failing() -> CardsRequestTransport {
        CardsRequestTransport(response: nil, responseBody: nil)
    }

    private static func singleCardBody() -> Data {
        Data(
            """
            {
              "id": "card-1",
              "game": "one_piece",
              "name": "Monkey D. Luffy",
              "set_name": "Romance Dawn",
              "card_number": "OP01-003",
              "notes": null,
              "quantities": [
                { "condition": "near_mint", "quantity": 2 },
                { "condition": "played", "quantity": 1 }
              ],
              "created_at": "2026-07-12T12:00:00.000Z",
              "updated_at": "2026-07-12T12:00:00.000Z"
            }
            """.utf8)
    }

    func send(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL _: URL,
        operationID: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        let requestBody: Data?
        if let body {
            requestBody = try await .init(collecting: body, upTo: .max)
        } else {
            requestBody = nil
        }
        requests.append(
            .init(
                method: request.method,
                path: request.path,
                operationID: operationID,
                body: requestBody,
                authorization: request.headerFields[.authorization]
            )
        )

        guard let response else { throw CardsTransportError.failed }

        return (response, responseBody.map(HTTPBody.init))
    }
}

private struct RecordedCardsRequest: Sendable {
    let method: HTTPRequest.Method
    let path: String?
    let operationID: String
    let body: Data?
    let authorization: String?
}

private enum CardsTransportError: Error {
    case failed
}
