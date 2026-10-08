//
//  TCGCardsClient.swift
//  TCGClient
//
//  Created by Kamaal M Farah on 7/20/26.
//

import Foundation
import OpenAPIRuntime
import TCGUtils

public protocol TCGCardsClient: Sendable {
    func list(game: ClientCardGame?) async -> Result<[CardWithPrice], ListCardsErrors>
    /// Matches any selected set name exactly; an empty selection includes all sets.
    func list(game: ClientCardGame?, setNames: Set<String>) async -> Result<CardCollection, ListCardsErrors>
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
        await list(game: game, setNames: []).map(\.cards)
    }

    func list(game: ClientCardGame?, setNames: Set<String>) async -> Result<CardCollection, ListCardsErrors> {
        let response: Operations.GetAppApiCards.Output
        do {
            response = try await client.getAppApiCards(
                query: .init(game: game.map(Self.makeListGame), setName: setNames.isEmpty ? nil : setNames.sorted())
            )
        } catch {
            return .failure(.unknown(status: 503, payload: nil, cause: error))
        }

        switch response {
        case .ok(let response):
            do {
                let collection = try response.body.json
                return .success(
                    CardCollection(
                        cards: collection.cards.map(Self.makeCardWithPrice),
                        availableSetNames: Set(collection.availableSetNames)
                    )
                )
            } catch {
                return .failure(.unknown(status: 503, payload: nil, cause: error))
            }
        case .unauthorized:
            return .failure(.unauthorized)
        case .badRequest:
            return .failure(.unknown(status: 400, payload: nil, cause: nil))
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
                .badRequest(validations: TCGClientValidationErrorParser.parseIssues(from: try? response.body.json))
            )
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
                .badRequest(validations: TCGClientValidationErrorParser.parseIssues(from: try? response.body.json))
            )
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
            purchases: payload.purchases.map(Self.makeGeneratedBatch)
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
            createdAt: card.createdAt,
            updatedAt: card.updatedAt,
            purchases: card.purchases.map(Self.makeBatch),
            purchasePriceChangePercent: card.purchasePriceChangePercent
        )
    }

    private static func makeGeneratedBatch(_ batch: CardPurchase) -> Components.Schemas.CardPurchaseInput {
        .init(
            id: batch.id,
            condition: makeGeneratedCondition(batch.condition),
            quantity: batch.quantity,
            purchasePrice: batch.purchasePrice.map { NSDecimalNumber(decimal: $0).stringValue },
            currency: batch.currency.flatMap { .init(rawValue: $0.rawValue) }
        )
    }

    private static func makeBatch(_ batch: Components.Schemas.CardPurchase) -> CardPurchase {
        CardPurchase(
            id: batch.id,
            condition: makeCondition(batch.condition),
            quantity: batch.quantity,
            purchasePrice: batch.purchasePrice.flatMap {
                Decimal(string: $0, locale: TCGLocales.decimal)
            },
            currency: batch.currency.flatMap { Currency(rawValue: $0.rawValue) },
            automaticPriceDate: batch.automaticPriceDate
        )
    }

    private static func makeGeneratedCondition(
        _ condition: CardCondition
    ) -> Components.Schemas.CardPurchaseInput.ConditionPayload {
        switch condition {
        case .mint: .mint
        case .nearMint: .nearMint
        case .excellent: .excellent
        case .good: .good
        case .played: .played
        case .damaged: .damaged
        }
    }

    private static func makeCondition(_ condition: Components.Schemas.CardPurchase.ConditionPayload) -> CardCondition {
        switch condition {
        case .mint: .mint
        case .nearMint: .nearMint
        case .excellent: .excellent
        case .good: .good
        case .played: .played
        case .damaged: .damaged
        }
    }

    private static func makeGeneratedGame(_ game: ClientCardGame) -> Components.Schemas.UpsertCard.GamePayload {
        switch game {
        case .onePiece: .onePiece
        case .pokemon: .pokemon
        }
    }

    private static func makeGame(_ game: Components.Schemas.Card.GamePayload) -> ClientCardGame {
        switch game {
        case .onePiece: .onePiece
        case .pokemon: .pokemon
        }
    }
}
