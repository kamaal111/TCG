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

    func moveFromUnfiled(id: UUID, to collectionID: UUID) -> Result<Void, CollectionsError> {
        state.cards.withLock { cards in
            guard let index = cards.firstIndex(where: { $0.id == id }) else { return .failure(.notFound) }
            guard cards[index].collectionID == nil else { return .failure(.conflict) }
            let card = cards[index]
            cards[index] = Card(
                id: card.id,
                game: card.game,
                name: card.name,
                setName: card.setName,
                cardNumber: card.cardNumber,
                notes: card.notes,
                createdAt: card.createdAt,
                updatedAt: card.updatedAt,
                purchases: card.purchases,
                purchasePriceChangePercent: card.purchasePriceChangePercent,
                displayCurrency: card.displayCurrency,
                collectionID: collectionID,
                allocationAdjustments: card.allocationAdjustments,
                illustrator: card.illustrator,
                englishSearchAlias: card.englishSearchAlias
            )
            return .success(())
        }
    }

    func details(id: UUID) async -> Result<CardWithPrice, OwnedCardReadError> {
        if case .serverUnavailable = outcome { return .failure(.unavailable) }

        return state.cards.withLock { cards in
            guard let card = cards.first(where: { $0.id == id }) else { return .failure(.notFound) }

            return .success(pricedEntry(for: card))
        }
    }

    func prices(ids: [UUID]) async -> Result<[OwnedCardPriceUpdate], OwnedCardReadError> {
        if case .serverUnavailable = outcome { return .failure(.unavailable) }

        let requested = Set(ids)
        let cards = state.cards.withLock { $0.filter { requested.contains($0.id) } }
        return .success(
            cards.compactMap { card in
                guard let price = pricedEntry(for: card).price else { return nil }

                return OwnedCardPriceUpdate(
                    updatedAt: card.updatedAt,
                    price: price,
                    displayCurrency: card.displayCurrency,
                    illustrator: card.illustrator,
                    purchasePriceChangePercent: card.purchasePriceChangePercent,
                    purchases: card.purchases
                )
            }
        )
    }

    private func pricedEntry(for card: Card) -> CardWithPrice {
        if case .successWithPrices(let entries) = outcome, let existing = entries.find(by: \.card, is: card) {
            return existing
        }

        return CardWithPrice(card: card, price: Self.price(for: card), imageURL: nil)
    }

    func exportCards() async -> Result<[Card], CardBackupErrors> {
        if case .serverUnavailable = outcome { return .failure(.unknown(status: 503)) }
        return .success(state.cards.withLock { $0 })
    }

    func importCards(_ payload: ImportCardsPayload) async -> Result<ImportCardsResult, CardBackupErrors> {
        if case .validationErrors(let issues) = outcome { return .failure(.badRequest(validations: issues)) }
        if case .serverUnavailable = outcome { return .failure(.unknown(status: 503)) }
        let resolved = payload.cards.compactMap { input in
            Self.printing(for: input.pricedCardID).map { (input, $0) }
        }
        guard resolved.count == payload.cards.count else { return .failure(.badRequest(validations: [])) }
        return state.cards.withLock { cards in
            var count = 0
            var updated = 0
            for (input, printing) in resolved {
                let imported = Card(
                    id: input.id,
                    game: printing.game,
                    name: printing.name,
                    setName: printing.setName ?? "",
                    cardNumber: printing.cardNumber,
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
                            automaticPriceDate: purchase.automaticPriceDate,
                            displayPrice: nil
                        )
                    },
                    purchasePriceChangePercent: nil,
                    displayCurrency: nil,
                    collectionID: cards.first(where: { $0.id == input.id })?.collectionID,
                    allocationAdjustments: nil,
                    illustrator: printing.illustrator,
                    englishSearchAlias: nil
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
                .init(
                    importedCount: count,
                    updatedCount: updated,
                    skippedCount: payload.cards.count - count - updated,
                    allocationAdjustments: nil
                )
            )
        }
    }

    func listPage(_ query: ListCardsQuery) async -> Result<
        CardCollectionPage, ListCardsErrors
    > {
        if case .serverUnavailable = outcome { return .failure(.unavailable) }

        let offset: Int
        if let cursor = query.cursor {
            guard let parsed = Int(cursor) else { return .failure(.unknown(status: 400, payload: nil, cause: nil)) }
            guard parsed >= 0 else { return .failure(.unknown(status: 400, payload: nil, cause: nil)) }

            offset = parsed
        } else {
            offset = 0
        }

        let cards = state.cards.withLock { cards in
            cards.compactMap { card -> CardWithPrice? in
                guard query.game == nil || card.game == query.game else { return nil }
                let selected = query.collectionID == PreviewTCGCollectionsClient.unfiledID ? nil : query.collectionID
                guard query.collectionID == nil || card.collectionID == selected else { return nil }

                return pricedEntry(for: card)
            }
        }
        let matchingCards = cards.filter { entry in
            let containsQuery =
                query.illustrators.isEmpty
                || (entry.card.game == .pokemon
                    && query.illustrators.contains(where: { name in
                        name.caseInsensitiveCompare(entry.card.illustrator ?? "") == .orderedSame
                    }))
            guard containsQuery else { return false }
            guard query.setNames.isEmpty || query.setNames.contains(entry.card.setName) else { return false }
            guard let search = query.query else { return true }
            return entry.card.matchesSearch(search)
        }
        guard offset <= matchingCards.count else {
            return .failure(.unknown(status: 400, payload: nil, cause: nil))
        }

        let end = min(offset + 50, matchingCards.count)
        return .success(
            .init(
                cards: Array(matchingCards[offset..<end]),
                availableSetNames: Set(cards.map(\.card.setName)),
                nextCursor: end < matchingCards.count ? String(end) : nil,
                availableIllustrators: Set(
                    cards.compactMap { entry in
                        entry.card.game == .pokemon ? entry.card.illustrator : nil
                    }
                )
            )
        )
    }

    func create(with payload: CreateCardPayload) async -> Result<CardWithPrice, CreateCardErrors> {
        if case .validationErrors(let issues) = outcome { return .failure(.badRequest(validations: issues)) }
        if case .serverUnavailable = outcome { return .failure(.unavailable) }

        guard let printing = Self.printing(for: payload.pricedCardID) else {
            return .failure(.badRequest(validations: []))
        }
        let card = Card(
            id: UUID(),
            game: printing.game,
            name: printing.name,
            setName: printing.setName ?? "",
            cardNumber: printing.cardNumber,
            notes: payload.notes,
            createdAt: Self.fixedDate,
            updatedAt: Self.fixedDate,
            purchases: payload.purchases,
            purchasePriceChangePercent: nil,
            displayCurrency: nil,
            collectionID: Self.collectionID(payload.collectionID),
            allocationAdjustments: nil,
            illustrator: printing.illustrator,
            englishSearchAlias: nil
        )
        state.cards.withLock { $0.append(card) }
        return .success(
            CardWithPrice(
                card: card,
                price: .init(cardId: card.id, status: .priced, price: printing, valuation: nil),
                imageURL: nil
            )
        )
    }

    func update(id: UUID, with payload: UpdateCardPayload) async -> Result<CardWithPrice, UpdateCardErrors> {
        if case .notFound = outcome { return .failure(.notFound) }
        if case .validationErrors(let issues) = outcome { return .failure(.badRequest(validations: issues)) }
        if case .serverUnavailable = outcome { return .failure(.unavailable) }

        return state.cards.withLock { cards in
            guard let index = cards.firstIndex(where: { $0.id == id }) else { return .failure(.notFound) }
            let previous = cards[index]
            let card = Card(
                id: id,
                game: previous.game,
                name: previous.name,
                setName: previous.setName,
                cardNumber: previous.cardNumber,
                notes: payload.notes,
                createdAt: previous.createdAt,
                updatedAt: Self.fixedDate,
                purchases: payload.purchases,
                purchasePriceChangePercent: nil,
                displayCurrency: nil,
                collectionID: Self.collectionID(payload.collectionID ?? previous.collectionID),
                allocationAdjustments: nil,
                illustrator: previous.illustrator,
                englishSearchAlias: previous.englishSearchAlias
            )
            cards[index] = card
            return .success(CardWithPrice(card: card, price: Self.price(for: card), imageURL: nil))
        }
    }

    static func price(for card: Card) -> OwnedCardPrice {
        let pricedCard = PreviewTCGPricingClient.samplePricedCards.first { $0.game == card.game }
        return OwnedCardPrice(
            cardId: card.id,
            status: pricedCard == nil ? .noMatch : .priced,
            price: pricedCard,
            valuation: nil
        )
    }

    func delete(ids: [UUID]) async -> Result<DeleteCardsResult, DeleteCardsErrors> {
        if case .serverUnavailable = outcome { return .failure(.unknown(status: 503, payload: nil, cause: nil)) }
        if case .validationErrors(let issues) = outcome { return .failure(.badRequest(validations: issues)) }
        var seen = Set<UUID>()
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
            id: UUID(uuid: (0, 0, 0, 0, 0, 0, 64, 0, 128, 0, 0, 0, 0, 0, 0, 1)),
            game: .onePiece,
            name: "Monkey D. Luffy",
            setName: "Romance Dawn",
            cardNumber: "OP01-003",
            notes: nil,
            createdAt: fixedDate,
            updatedAt: fixedDate,
            purchases: [
                .init(
                    id: nil,
                    condition: .nearMint,
                    quantity: 2,
                    purchasePrice: nil,
                    currency: nil,
                    automaticPriceDate: nil,
                    displayPrice: nil
                ),
                .init(
                    id: nil,
                    condition: .played,
                    quantity: 1,
                    purchasePrice: nil,
                    currency: nil,
                    automaticPriceDate: nil,
                    displayPrice: nil
                ),
            ],
            purchasePriceChangePercent: nil,
            displayCurrency: nil,
            collectionID: nil,
            allocationAdjustments: nil,
            illustrator: nil,
            englishSearchAlias: nil
        ),
        Card(
            id: UUID(uuid: (0, 0, 0, 0, 0, 0, 64, 0, 128, 0, 0, 0, 0, 0, 0, 2)),
            game: .pokemon,
            name: "Pikachu",
            setName: "Base Set",
            cardNumber: "58/102",
            notes: "First edition",
            createdAt: fixedDate,
            updatedAt: fixedDate,
            purchases: [
                .init(
                    id: nil,
                    condition: .mint,
                    quantity: 1,
                    purchasePrice: nil,
                    currency: nil,
                    automaticPriceDate: nil,
                    displayPrice: nil
                )
            ],
            purchasePriceChangePercent: nil,
            displayCurrency: nil,
            collectionID: nil,
            allocationAdjustments: nil,
            illustrator: "Mitsuhiro Arita",
            englishSearchAlias: nil
        ),
    ]

    private static let fixedDate = Date(timeIntervalSince1970: 1_750_000_000)

    private static func printing(for id: UUID) -> PricedCard? {
        PreviewTCGPricingClient.samplePricedCards.first { UUID(uuidString: $0.id) == id }
    }

    private static func collectionID(_ id: UUID?) -> UUID? {
        id == PreviewTCGCollectionsClient.unfiledID ? nil : id
    }
}

private final class PreviewTCGCardsState: Sendable {
    let cards: Mutex<[Card]>

    init(cards: [Card]) {
        self.cards = Mutex(cards)
    }
}
