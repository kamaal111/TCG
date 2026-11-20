//
//  OwnedCardPrice.swift
//  TCGClient
//

import Foundation

public enum OwnedCardPriceStatus: String, Codable, Hashable, Sendable {
    /// The placeholder stored by older collection caches.
    case pending
    case priced
    case noMatch = "no_match"
    case noPrice = "no_price"
    case unavailable
}

public struct OwnedValuation: Codable, Hashable, Sendable {
    public let amount: Double
    public let currency: Currency
    public let estimated: Bool
    public let conversionUnavailable: Bool
    public let purchasePriceChangePercent: Double?

    public init(
        amount: Double,
        currency: Currency,
        estimated: Bool,
        conversionUnavailable: Bool,
        purchasePriceChangePercent: Double?
    ) {
        self.amount = amount
        self.currency = currency
        self.estimated = estimated
        self.conversionUnavailable = conversionUnavailable
        self.purchasePriceChangePercent = purchasePriceChangePercent
    }

    private enum CodingKeys: String, CodingKey {
        case amount, currency, estimated
        case conversionUnavailable = "conversion_unavailable"
        case purchasePriceChangePercent = "purchase_price_change_percent"
    }
}

public struct OwnedCardPrice: Codable, Hashable, Sendable {
    public let cardId: UUID
    public let status: OwnedCardPriceStatus
    public let price: PricedCard?
    public let valuation: OwnedValuation?

    public init(cardId: UUID, status: OwnedCardPriceStatus, price: PricedCard?, valuation: OwnedValuation?) {
        self.cardId = cardId
        self.status = status
        self.price = price
        self.valuation = valuation
    }

    private enum CodingKeys: String, CodingKey {
        case status
        case price, valuation
        case cardId = "card_id"
    }
}

public struct OwnedCardPriceUpdate: Codable, Equatable, Sendable {
    public let updatedAt: Date
    public let price: OwnedCardPrice
    public let displayCurrency: Currency?
    public let illustrator: String?
    public let purchasePriceChangePercent: Double?
    public let purchases: [CardPurchase]

    public var cardID: UUID { price.cardId }
}
