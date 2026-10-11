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

    func exportCards() async -> Result<[Card], CardBackupErrors> {
        if case .serverUnavailable = outcome { return .failure(.unknown(status: 503)) }
        return .success(state.cards.withLock { $0 })
    }

    func importCards(_ payload: ImportCardsPayload) async -> Result<ImportCardsResult, CardBackupErrors> {
        if case .validationErrors(let issues) = outcome { return .failure(.badRequest(validations: issues)) }
        if case .serverUnavailable = outcome { return .failure(.unknown(status: 503)) }
        return state.cards.withLock { cards in
            var count = 0
            var updated = 0
            for input in payload.cards {
                let imported = Card(
                    id: input.id,
                    game: input.game,
                    name: input.name,
                    setName: input.setName,
                    cardNumber: input.cardNumber,
                    notes: input.notes,
                    createdAt: input.createdAt,
                    updatedAt: input.updatedAt,
                    purchases: input.purchases.map { purchase in
                        CardPurchase(
                            id: purchase.id,
                            condition: purchase.condition,
                            quantity: purchase.quantity,
                            purchasePrice: purchase.purchasePrice.flatMap { Decimal(string: $0) },
                            currency: purchase.currency,
                            automaticPriceDate: purchase.automaticPriceDate
                        )
                    }
                )
                if let index = cards.firstIndex(where: { $0.id == input.id }) {
                    if cards[index] != imported {
                        cards[index] = imported
                        updated += 1
                    }
                } else {
                    cards.append(imported)
                    count += 1
                }
            }
            return .success(
                .init(importedCount: count, updatedCount: updated, skippedCount: payload.cards.count - count - updated)
            )
        }
    }

    func listPage(game: ClientCardGame?, setNames: Set<String>, cursor: String?) async -> Result<
        CardCollectionPage, ListCardsErrors
    > {
        if case .serverUnavailable = outcome { return .failure(.unavailable) }

        let offset: Int
        if let cursor {
            guard let parsed = Int(cursor) else { return .failure(.unknown(status: 400, payload: nil, cause: nil)) }
            guard parsed >= 0 else { return .failure(.unknown(status: 400, payload: nil, cause: nil)) }

            offset = parsed
        } else {
            offset = 0
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
        let matchingCards = cards.filter { setNames.isEmpty || setNames.contains($0.card.setName) }
        guard offset <= matchingCards.count else {
            return .failure(.unknown(status: 400, payload: nil, cause: nil))
        }

        let end = min(offset + 50, matchingCards.count)
        return .success(
            .init(
                cards: Array(matchingCards[offset..<end]),
                availableSetNames: Set(cards.map(\.card.setName)),
                nextCursor: end < matchingCards.count ? String(end) : nil
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

    func delete(ids: [String]) async -> Result<DeleteCardsResult, DeleteCardsErrors> {
        if case .serverUnavailable = outcome { return .failure(.unknown(status: 503, payload: nil, cause: nil)) }
        if case .validationErrors(let issues) = outcome { return .failure(.badRequest(validations: issues)) }
        var seen = Set<String>()
        let uniqueIDs = ids.filter { seen.insert($0).inserted }
        if case .notFound = outcome {
            return .success(DeleteCardsResult(deletedIDs: [], notFoundIDs: uniqueIDs))
        }

        return state.cards.withLock { cards in
            let existingIDs = Set(cards.map(\.id))
            let selectedIDs = Set(uniqueIDs)
            cards.removeAll { selectedIDs.contains($0.id) }
            return .success(
                DeleteCardsResult(
                    deletedIDs: uniqueIDs.filter { existingIDs.contains($0) },
                    notFoundIDs: uniqueIDs.filter { !existingIDs.contains($0) }
                )
            )
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
