//
//  TCGCardsClient.swift
//  TCGClient
//
//  Created by Kamaal M Farah on 7/20/26.
//

import Foundation
import KamaalLogger
import OpenAPIRuntime

private let logger = KamaalLogger(from: TCGCardsClient.self)

public protocol TCGCardsClient: Sendable {
    func list() async -> Result<[Card], ListCardsErrors>
    func create(with payload: UpsertCardPayload) async -> Result<Card, CreateCardErrors>
    func update(id: String, with payload: UpsertCardPayload) async -> Result<Card, UpdateCardErrors>
    func delete(id: String) async -> Result<Void, DeleteCardErrors>
}

public struct TCGCardsClientImpl: TCGCardsClient {
    private let client: Client

    init(client: Client) {
        self.client = client
    }

    public func list() async -> Result<[Card], ListCardsErrors> {
        let response: Operations.GetAppApiCards.Output
        do {
            response = try await client.getAppApiCards()
        } catch {
            logRequestFailure(operation: "Cards list", error: error)
            return .failure(.unknown(status: 503, payload: nil, cause: error))
        }

        let payload: Operations.GetAppApiCards.Output.Ok
        switch response {
        case .notFound:
            return .failure(.unauthorized)
        case .undocumented(let statusCode, let payload):
            logger.warning("Cards list received an unexpected response from the server (status \(statusCode)).")
            return .failure(.unknown(status: statusCode, payload: payload, cause: nil))
        case .ok(let ok):
            payload = ok
        }

        let responsePayload: Components.Schemas.CardsListResponse
        do {
            responsePayload = try payload.body.json
        } catch {
            return .failure(.unknown(status: 503, payload: nil, cause: error))
        }

        return .success(responsePayload.cards.map(Card.init(schema:)))
    }

    public func create(with payload: UpsertCardPayload) async -> Result<Card, CreateCardErrors> {
        let response: Operations.PostAppApiCards.Output
        do {
            response = try await client.postAppApiCards(body: .json(payload.asSchema))
        } catch {
            logRequestFailure(operation: "Card creation", error: error)
            return .failure(.unknown(status: 503, payload: nil, cause: error))
        }

        let createdPayload: Operations.PostAppApiCards.Output.Created
        switch response {
        case .badRequest(let badRequestResponse):
            let body = try? badRequestResponse.body.json
            let validations = TCGClientValidationErrorParser.parseIssues(from: body)

            return .failure(.badRequest(validations: validations))
        case .notFound:
            return .failure(.unauthorized)
        case .undocumented(let statusCode, let payload):
            logger.warning("Card creation received an unexpected response from the server (status \(statusCode)).")
            return .failure(.unknown(status: statusCode, payload: payload, cause: nil))
        case .created(let created):
            createdPayload = created
        }

        let responsePayload: Components.Schemas.Card
        do {
            responsePayload = try createdPayload.body.json
        } catch {
            return .failure(.unknown(status: 503, payload: nil, cause: error))
        }

        return .success(Card(schema: responsePayload))
    }

    public func update(id: String, with payload: UpsertCardPayload) async -> Result<Card, UpdateCardErrors> {
        let response: Operations.PutAppApiCardsCardId.Output
        do {
            response = try await client.putAppApiCardsCardId(
                path: .init(cardId: id),
                body: .json(payload.asSchema)
            )
        } catch {
            logRequestFailure(operation: "Card update", error: error)
            return .failure(.unknown(status: 503, payload: nil, cause: error))
        }

        let okPayload: Operations.PutAppApiCardsCardId.Output.Ok
        switch response {
        case .badRequest(let badRequestResponse):
            let body = try? badRequestResponse.body.json
            let validations = TCGClientValidationErrorParser.parseIssues(from: body)

            return .failure(.badRequest(validations: validations))
        case .notFound(let notFoundResponse):
            let body = try? notFoundResponse.body.json
            guard CardsNotFoundCode(rawValue: body?.code ?? "") == .cardNotFound else {
                return .failure(.unauthorized)
            }
            return .failure(.notFound)
        case .undocumented(let statusCode, let payload):
            logger.warning("Card update received an unexpected response from the server (status \(statusCode)).")
            return .failure(.unknown(status: statusCode, payload: payload, cause: nil))
        case .ok(let ok):
            okPayload = ok
        }

        let responsePayload: Components.Schemas.Card
        do {
            responsePayload = try okPayload.body.json
        } catch {
            return .failure(.unknown(status: 503, payload: nil, cause: error))
        }

        return .success(Card(schema: responsePayload))
    }

    public func delete(id: String) async -> Result<Void, DeleteCardErrors> {
        let response: Operations.DeleteAppApiCardsCardId.Output
        do {
            response = try await client.deleteAppApiCardsCardId(path: .init(cardId: id))
        } catch {
            logRequestFailure(operation: "Card deletion", error: error)
            return .failure(.unknown(status: 503, payload: nil, cause: error))
        }

        switch response {
        case .notFound(let notFoundResponse):
            let body = try? notFoundResponse.body.json
            guard CardsNotFoundCode(rawValue: body?.code ?? "") == .cardNotFound else {
                return .failure(.unauthorized)
            }
            return .failure(.notFound)
        case .undocumented(let statusCode, let payload):
            logger.warning("Card deletion received an unexpected response from the server (status \(statusCode)).")
            return .failure(.unknown(status: statusCode, payload: payload, cause: nil))
        case .ok:
            return .success(())
        }
    }

    private func logRequestFailure(operation: String, error: Error) {
        guard let clientError = error as? ClientError, let response = clientError.response else {
            logger.error("\(operation) request failed before receiving a server response.")
            return
        }

        logger.error("\(operation) response could not be decoded (status \(response.status.code)).")
    }
}

private enum CardsNotFoundCode: String {
    case cardNotFound = "CARD_NOT_FOUND"
}

extension Card {
    init(schema: Components.Schemas.Card) {
        self.init(
            id: schema.id,
            game: CardGame(schema: schema.game),
            name: schema.name,
            setName: schema.setName,
            cardNumber: schema.cardNumber,
            notes: schema.notes,
            quantities: schema.quantities.map(CardConditionQuantity.init(schema:)),
            createdAt: schema.createdAt,
            updatedAt: schema.updatedAt
        )
    }
}

extension CardGame {
    init(schema: Components.Schemas.Card.GamePayload) {
        switch schema {
        case .onePiece:
            self = .onePiece
        case .pokemon:
            self = .pokemon
        }
    }

    var asUpsertSchema: Components.Schemas.UpsertCard.GamePayload {
        switch self {
        case .onePiece:
            .onePiece
        case .pokemon:
            .pokemon
        }
    }
}

extension CardCondition {
    init(schema: Components.Schemas.CardConditionQuantity.ConditionPayload) {
        switch schema {
        case .mint:
            self = .mint
        case .nearMint:
            self = .nearMint
        case .excellent:
            self = .excellent
        case .good:
            self = .good
        case .played:
            self = .played
        case .damaged:
            self = .damaged
        }
    }

    var asUpsertSchema: Components.Schemas.UpsertCard.QuantitiesPayloadPayload.ConditionPayload {
        switch self {
        case .mint:
            .mint
        case .nearMint:
            .nearMint
        case .excellent:
            .excellent
        case .good:
            .good
        case .played:
            .played
        case .damaged:
            .damaged
        }
    }
}

extension CardConditionQuantity {
    init(schema: Components.Schemas.CardConditionQuantity) {
        self.init(condition: CardCondition(schema: schema.condition), quantity: schema.quantity)
    }
}

extension UpsertCardPayload {
    var asSchema: Components.Schemas.UpsertCard {
        .init(
            game: game.asUpsertSchema,
            name: name,
            setName: setName,
            cardNumber: cardNumber,
            notes: notes,
            quantities: quantities.map { quantity in
                .init(condition: quantity.condition.asUpsertSchema, quantity: quantity.quantity)
            }
        )
    }
}
