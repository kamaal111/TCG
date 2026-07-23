//
//  TCGCardsClient.swift
//  TCGClient
//
//  Created by Kamaal M Farah on 7/20/26.
//

import OpenAPIRuntime

public protocol TCGCardsClient: Sendable {
    func list(game: ClientCardGame?) async -> Result<[CardWithPrice], ListCardsErrors>
    func create(with payload: UpsertCardPayload) async -> Result<CardWithPrice, CreateCardErrors>
    func update(id: String, with payload: UpsertCardPayload) async -> Result<CardWithPrice, UpdateCardErrors>
    func delete(id: String) async -> Result<Void, DeleteCardErrors>
}

struct TCGCardsClientImpl: TCGCardsClient {
    private let client: Client

    init(client: Client) {
        self.client = client
    }

    func list(game: ClientCardGame?) async -> Result<[CardWithPrice], ListCardsErrors> {
        let response: Operations.GetAppApiCards.Output
        do {
            response = try await client.getAppApiCards(
                query: .init(game: game.map(Self.makeListGame))
            )
        } catch {
            return .failure(.unknown(status: 503, payload: nil, cause: error))
        }

        switch response {
        case .ok(let response):
            do {
                return .success(try response.body.json.cards.map(Self.makeCardWithPrice))
            } catch {
                return .failure(.unknown(status: 503, payload: nil, cause: error))
            }
        case .unauthorized:
            return .failure(.unauthorized)
        case .serviceUnavailable:
            return .failure(.unavailable)
        case .undocumented(let status, let payload):
            return .failure(.unknown(status: status, payload: payload, cause: nil))
        }
    }

    func create(with payload: UpsertCardPayload) async -> Result<CardWithPrice, CreateCardErrors> {
        let response: Operations.PostAppApiCards.Output
        do {
            response = try await client.postAppApiCards(body: .json(Self.makeGeneratedPayload(payload)))
        } catch {
            return .failure(.unknown(status: 503, payload: nil, cause: error))
        }

        switch response {
        case .created(let response):
            do {
                return .success(Self.makeCardWithPrice(try response.body.json))
            } catch {
                return .failure(.unknown(status: 503, payload: nil, cause: error))
            }
        case .badRequest(let response):
            return .failure(
                .badRequest(validations: TCGClientValidationErrorParser.parseIssues(from: try? response.body.json)))
        case .unauthorized:
            return .failure(.unauthorized)
        case .serviceUnavailable:
            return .failure(.unavailable)
        case .undocumented(let status, let payload):
            return .failure(.unknown(status: status, payload: payload, cause: nil))
        }
    }

    func update(id: String, with payload: UpsertCardPayload) async -> Result<CardWithPrice, UpdateCardErrors> {
        let response: Operations.PutAppApiCardsCardId.Output
        do {
            response = try await client.putAppApiCardsCardId(
                path: .init(cardId: id),
                body: .json(Self.makeGeneratedPayload(payload))
            )
        } catch {
            return .failure(.unknown(status: 503, payload: nil, cause: error))
        }

        switch response {
        case .ok(let response):
            do {
                return .success(Self.makeCardWithPrice(try response.body.json))
            } catch {
                return .failure(.unknown(status: 503, payload: nil, cause: error))
            }
        case .badRequest(let response):
            return .failure(
                .badRequest(validations: TCGClientValidationErrorParser.parseIssues(from: try? response.body.json)))
        case .unauthorized:
            return .failure(.unauthorized)
        case .notFound:
            return .failure(.notFound)
        case .serviceUnavailable:
            return .failure(.unavailable)
        case .undocumented(let status, let payload):
            return .failure(.unknown(status: status, payload: payload, cause: nil))
        }
    }

    func delete(id: String) async -> Result<Void, DeleteCardErrors> {
        let response: Operations.DeleteAppApiCardsCardId.Output
        do {
            response = try await client.deleteAppApiCardsCardId(path: .init(cardId: id))
        } catch {
            return .failure(.unknown(status: 503, payload: nil, cause: error))
        }

        switch response {
        case .ok:
            return .success(())
        case .unauthorized:
            return .failure(.unauthorized)
        case .notFound:
            return .failure(.notFound)
        case .undocumented(let status, let payload):
            return .failure(.unknown(status: status, payload: payload, cause: nil))
        }
    }

    private static func makeGeneratedPayload(_ payload: UpsertCardPayload) -> Components.Schemas.UpsertCard {
        .init(
            game: makeGeneratedGame(payload.game),
            name: payload.name,
            setName: payload.setName,
            cardNumber: payload.cardNumber,
            notes: payload.notes,
            quantities: payload.quantities.map {
                .init(condition: makeGeneratedCondition($0.condition), quantity: $0.quantity)
            }
        )
    }

    private static func makeListGame(_ game: ClientCardGame) -> Operations.GetAppApiCards.Input.Query.GamePayload {
        switch game {
        case .onePiece: .onePiece
        case .pokemon: .pokemon
        }
    }

    private static func makeCardWithPrice(_ cardWithPrice: Components.Schemas.CardWithPrice) -> CardWithPrice {
        CardWithPrice(
            card: makeCard(cardWithPrice.value1),
            price: PricedCardMapper.makeOwnedPrice(cardWithPrice.value2.price)
        )
    }

    private static func makeCard(_ card: Components.Schemas.Card) -> Card {
        Card(
            id: card.id,
            game: makeGame(card.game),
            name: card.name,
            setName: card.setName,
            cardNumber: card.cardNumber,
            notes: card.notes,
            quantities: card.quantities.map {
                CardConditionQuantity(condition: makeCondition($0.condition), quantity: $0.quantity)
            },
            createdAt: card.createdAt,
            updatedAt: card.updatedAt
        )
    }

    private static func makeGeneratedGame(_ game: ClientCardGame) -> Components.Schemas.UpsertCard.GamePayload {
        switch game {
        case .onePiece: .onePiece
        case .pokemon: .pokemon
        }
    }

    private static func makeGeneratedCondition(
        _ condition: CardCondition
    ) -> Components.Schemas.CardConditionQuantity.ConditionPayload {
        switch condition {
        case .mint: .mint
        case .nearMint: .nearMint
        case .excellent: .excellent
        case .good: .good
        case .played: .played
        case .damaged: .damaged
        }
    }

    private static func makeGame(_ game: Components.Schemas.Card.GamePayload) -> ClientCardGame {
        switch game {
        case .onePiece: .onePiece
        case .pokemon: .pokemon
        }
    }

    private static func makeCondition(
        _ condition: Components.Schemas.CardConditionQuantity.ConditionPayload
    ) -> CardCondition {
        switch condition {
        case .mint: .mint
        case .nearMint: .nearMint
        case .excellent: .excellent
        case .good: .good
        case .played: .played
        case .damaged: .damaged
        }
    }
}
