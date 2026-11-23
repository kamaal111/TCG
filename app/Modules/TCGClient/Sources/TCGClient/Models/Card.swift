//
//  Card.swift
//  TCGClient
//
//  Created by Kamaal M Farah on 7/20/26.
//

import Foundation
import KamaalExtensions

public enum ClientCardGame: String, Codable, Hashable, Sendable, CaseIterable {
    case onePiece = "one_piece"
    case pokemon

    public var title: String {
        switch self {
        case .onePiece: String(localized: "One Piece")
        case .pokemon: String(localized: "Pokémon")
        }
    }
}

public enum CardCondition: String, Codable, Hashable, Sendable, CaseIterable {
    case mint
    case nearMint = "near_mint"
    case excellent
    case good
    case played
    case damaged

    public var title: String {
        switch self {
        case .mint: String(localized: "Mint")
        case .nearMint: String(localized: "Near mint")
        case .excellent: String(localized: "Excellent")
        case .good: String(localized: "Good")
        case .played: String(localized: "Played")
        case .damaged: String(localized: "Damaged")
        }
    }
}

public struct CardConditionQuantity: Codable, Hashable, Sendable {
    public let condition: CardCondition
    public let quantity: Int

    public init(condition: CardCondition, quantity: Int) {
        self.condition = condition
        self.quantity = quantity
    }

    public static func totals(_ quantities: [Self]) -> [CardCondition: Int] {
        quantities.reduce(into: [:]) { totals, quantity in
            totals[quantity.condition, default: 0] += quantity.quantity
        }
    }
}

public struct Card: Codable, Hashable, Identifiable, Sendable {
    public let id: UUID
    public let collectionID: UUID?
    public let allocationAdjustments: Int?
    public let game: ClientCardGame
    public let name: String
    public let setName: String
    public let cardNumber: String
    public let illustrator: String?
    public let englishSearchAlias: String?
    public let notes: String?
    public let purchases: [CardPurchase]
    public let purchasePriceChangePercent: Double?
    public let displayCurrency: Currency?
    public let createdAt: Date
    public let updatedAt: Date

    /// Searches the saved name, English alias, set, and printed number using localized substring matching.
    public func matchesSearch(_ query: String) -> Bool {
        name.localizedStandardContains(query)
            || englishSearchAlias?.localizedStandardContains(query) == true
            || setName.localizedStandardContains(query)
            || cardNumber.localizedStandardContains(query)
    }

    public init(
        id: UUID,
        game: ClientCardGame,
        name: String,
        setName: String,
        cardNumber: String,
        notes: String?,
        createdAt: Date,
        updatedAt: Date,
        purchases: [CardPurchase],
        purchasePriceChangePercent: Double?,
        displayCurrency: Currency?,
        collectionID: UUID?,
        allocationAdjustments: Int?,
        illustrator: String?,
        englishSearchAlias: String?
    ) {
        self.collectionID = collectionID
        self.allocationAdjustments = allocationAdjustments
        self.id = id
        self.game = game
        self.name = name
        self.setName = setName
        self.illustrator = illustrator
        self.englishSearchAlias = englishSearchAlias
        self.cardNumber = cardNumber
        self.notes = notes
        self.purchases = purchases
        self.purchasePriceChangePercent = purchasePriceChangePercent
        self.displayCurrency = displayCurrency
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    public var totalQuantity: Int { purchases.sum(by: \.quantity) }

    public var quantities: [CardConditionQuantity] {
        let totals = CardConditionQuantity.totals(
            purchases.map { CardConditionQuantity(condition: $0.condition, quantity: $0.quantity) }
        )
        return CardCondition.allCases.compactMap { condition in
            guard let quantity = totals[condition] else { return nil }
            return CardConditionQuantity(condition: condition, quantity: quantity)
        }
    }

    private enum CodingKeys: String, CodingKey {
        case collectionID = "collection_id"
        case allocationAdjustments = "allocation_adjustments"
        case id
        case game
        case name
        case notes
        case purchases
        case purchasePriceChangePercent = "purchase_price_change_percent"
        case displayCurrency = "display_currency"
        case setName = "set_name"
        case illustrator
        case englishSearchAlias = "english_search_alias"
        case cardNumber = "card_number"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

extension Card {
    /// Applies display values and purchase backfills without replacing owned-card details.
    public func replacingDisplay(with source: Card?) -> Card {
        replacingDisplay(
            purchases: source?.purchases ?? [],
            currency: source?.displayCurrency,
            illustrator: source?.illustrator,
            purchasePriceChangePercent: source?.purchasePriceChangePercent
        )
    }

    public func applyingPriceUpdate(_ update: OwnedCardPriceUpdate) -> Card {
        replacingDisplay(
            purchases: update.purchases,
            currency: update.displayCurrency,
            illustrator: update.illustrator,
            purchasePriceChangePercent: update.purchasePriceChangePercent
        )
    }

    private func replacingDisplay(
        purchases displayPurchases: [CardPurchase],
        currency: Currency?,
        illustrator: String?,
        purchasePriceChangePercent: Double?
    ) -> Card {
        let batches = Dictionary(
            displayPurchases.compactMap { batch in batch.id.map { ($0, batch) } },
            uniquingKeysWith: { first, _ in first }
        )
        return Card(
            id: id,
            game: game,
            name: name,
            setName: setName,
            cardNumber: cardNumber,
            notes: notes,
            createdAt: createdAt,
            updatedAt: updatedAt,
            purchases: purchases.map { purchase in
                let updated = purchase.id.flatMap { batches[$0] }
                let backfill = purchase.purchasePrice == nil ? updated : nil
                return CardPurchase(
                    id: purchase.id,
                    condition: purchase.condition,
                    quantity: purchase.quantity,
                    purchasePrice: purchase.purchasePrice ?? backfill?.purchasePrice,
                    currency: purchase.currency ?? backfill?.currency,
                    automaticPriceDate: purchase.automaticPriceDate ?? backfill?.automaticPriceDate,
                    displayPrice: updated?.displayPrice
                )
            },
            purchasePriceChangePercent: purchasePriceChangePercent,
            displayCurrency: currency,
            collectionID: collectionID,
            allocationAdjustments: allocationAdjustments,
            illustrator: illustrator ?? self.illustrator,
            englishSearchAlias: englishSearchAlias
        )
    }
}
