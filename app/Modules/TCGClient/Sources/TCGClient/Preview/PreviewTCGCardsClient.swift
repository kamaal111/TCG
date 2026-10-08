//
//  PreviewTCGCardsClient.swift
//  TCGClient
//
//  Created by Kamaal M Farah on 7/20/26.
//

import Foundation
import KamaalExtensions
import Synchronization

struct PreviewTCGCardsClient: TCGCardsClient {
    private let state: PreviewTCGCardsState
    private let outcome: PreviewTCGCardsOutcome

    init(outcome: PreviewTCGCardsOutcome) {
        self.outcome = outcome
        let cards: [Card]
        switch outcome {
        case .success(let success): cards = success
        case .successWithPrices(let success): cards = success.map(\.card)
        case .empty, .serverUnavailable: cards = []
        case .validationErrors, .notFound: cards = Self.sampleCards
        }
        state = PreviewTCGCardsState(cards: cards)
    }

    func list(game: ClientCardGame?) async -> Result<[CardWithPrice], ListCardsErrors> {
        await list(game: game, setNames: []).map(\.cards)
    }

    func list(game: ClientCardGame?, setNames: Set<String>) async -> Result<CardCollection, ListCardsErrors> {
        if case .serverUnavailable = outcome {
            return .failure(.unavailable)
        }
        let cards = state.cards.withLock { cards in
            cards.compactMap { card -> CardWithPrice? in
                guard game == nil || card.game == game else { return nil }

                if case .successWithPrices(let pricedCards) = outcome,
                    let existing = pricedCards.find(by: \.card, is: card)
                {
                    return existing
                }

                return CardWithPrice(card: card, price: Self.price(for: card))
            }
        }
        return .success(
            CardCollection(
                cards: cards.filter { setNames.isEmpty || setNames.contains($0.card.setName) },
                availableSetNames: Set(cards.map(\.card.setName))
            )
        )
    }

    func create(with payload: UpsertCardPayload) async -> Result<CardWithPrice, CreateCardErrors> {
        if case .validationErrors(let issues) = outcome { return .failure(.badRequest(validations: issues)) }
        if case .serverUnavailable = outcome { return .failure(.unavailable) }

        let card = state.cards.withLock { cards in
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

        return state.cards.withLock { cards in
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

        return state.cards.withLock { cards in
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
            createdAt: fixedDate,
            updatedAt: fixedDate,
            purchases: [
                .init(condition: .nearMint, quantity: 2),
                .init(condition: .played, quantity: 1),
            ]
        ),
        Card(
            id: "preview-card-2",
            game: .pokemon,
            name: "Pikachu",
            setName: "Base Set",
            cardNumber: "58/102",
            notes: "First edition",
            createdAt: fixedDate,
            updatedAt: fixedDate,
            purchases: [.init(condition: .mint, quantity: 1)]
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
            createdAt: createdAt,
            updatedAt: fixedDate,
            purchases: payload.purchases
        )
    }
}

private final class PreviewTCGCardsState: Sendable {
    let cards: Mutex<[Card]>

    init(cards: [Card]) {
        self.cards = Mutex(cards)
    }
}
