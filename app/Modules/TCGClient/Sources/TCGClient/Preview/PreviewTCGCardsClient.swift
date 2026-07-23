//
//  PreviewTCGCardsClient.swift
//  TCGClient
//
//  Created by Kamaal M Farah on 7/20/26.
//

import Foundation
import KamaalExtensions
import os

struct PreviewTCGCardsClient: TCGCardsClient {
    private let state: OSAllocatedUnfairLock<[Card]>
    private let outcome: PreviewTCGCardsOutcome

    init(outcome: PreviewTCGCardsOutcome) {
        self.outcome = outcome
        let cards: [Card]
        switch outcome {
        case .success(let success): cards = success
        case .empty, .serverUnavailable: cards = []
        case .validationErrors, .notFound: cards = Self.sampleCards
        }
        state = OSAllocatedUnfairLock(initialState: cards)
    }

    func list(game: ClientCardGame?) async -> Result<[CardWithPrice], ListCardsErrors> {
        if case .serverUnavailable = outcome {
            return .failure(.unavailable)
        }
        return .success(
            state.withLock { cards in
                (game == nil ? cards : cards.filter { $0.game == game }).map {
                    CardWithPrice(card: $0, price: Self.price(for: $0))
                }
            })
    }

    func create(with payload: UpsertCardPayload) async -> Result<CardWithPrice, CreateCardErrors> {
        if case .validationErrors(let issues) = outcome { return .failure(.badRequest(validations: issues)) }
        if case .serverUnavailable = outcome { return .failure(.unavailable) }

        let card = state.withLock { cards in
            let card = Self.makeCard(id: "preview-card-\(cards.count + 1)", payload: payload)
            cards.append(card)
            return card
        }
        return .success(CardWithPrice(card: card, price: Self.price(for: card)))
    }

    func update(id: String, with payload: UpsertCardPayload) async -> Result<CardWithPrice, UpdateCardErrors> {
        if case .notFound = outcome { return .failure(.notFound) }
        if case .validationErrors(let issues) = outcome { return .failure(.badRequest(validations: issues)) }
        if case .serverUnavailable = outcome { return .failure(.unavailable) }

        return state.withLock { cards in
            guard let index = cards.firstIndex(where: { $0.id == id }) else { return .failure(.notFound) }
            let card = Self.makeCard(id: id, payload: payload, createdAt: cards[index].createdAt)
            cards[index] = card
            return .success(CardWithPrice(card: card, price: Self.price(for: card)))
        }
    }

    static func price(for card: Card) -> OwnedCardPrice {
        let pricedCard = PreviewTCGPricingClient.samplePricedCards.first { $0.game == card.game }
        return OwnedCardPrice(cardId: card.id, status: pricedCard == nil ? .noMatch : .priced, price: pricedCard)
    }

    func delete(id: String) async -> Result<Void, DeleteCardErrors> {
        if case .notFound = outcome { return .failure(.notFound) }
        if case .serverUnavailable = outcome { return .failure(.unknown(status: 503, payload: nil, cause: nil)) }

        return state.withLock { cards in
            guard let index = cards.firstIndex(where: { $0.id == id }) else { return .failure(.notFound) }
            cards.remove(at: index)
            return .success(())
        }
    }

    static let sampleCards = [
        Card(
            id: "preview-card-1",
            game: .onePiece,
            name: "Monkey D. Luffy",
            setName: "Romance Dawn",
            cardNumber: "OP01-003",
            notes: nil,
            quantities: [
                .init(condition: .nearMint, quantity: 2),
                .init(condition: .played, quantity: 1),
            ],
            createdAt: fixedDate,
            updatedAt: fixedDate
        ),
        Card(
            id: "preview-card-2",
            game: .pokemon,
            name: "Pikachu",
            setName: "Base Set",
            cardNumber: "58/102",
            notes: "First edition",
            quantities: [.init(condition: .mint, quantity: 1)],
            createdAt: fixedDate,
            updatedAt: fixedDate
        ),
    ]

    private static let fixedDate = Date(timeIntervalSince1970: 1_750_000_000)

    private static func makeCard(
        id: String,
        payload: UpsertCardPayload,
        createdAt: Date = fixedDate
    ) -> Card {
        Card(
            id: id,
            game: payload.game,
            name: payload.name,
            setName: payload.setName,
            cardNumber: payload.cardNumber,
            notes: payload.notes,
            quantities: payload.quantities,
            createdAt: createdAt,
            updatedAt: fixedDate
        )
    }
}
