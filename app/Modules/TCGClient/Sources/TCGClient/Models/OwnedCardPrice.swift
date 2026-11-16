//
//  OwnedCardPrice.swift
//  TCGClient
//

import Foundation

public enum OwnedCardPriceStatus: String, Codable, Hashable, Sendable {
    case pending
    case priced
    case noMatch = "no_match"
    case noPrice = "no_price"
    case unavailable
}

public struct OwnedCardPrice: Codable, Hashable, Sendable {
    public let cardId: UUID
    public let status: OwnedCardPriceStatus
    public let price: PricedCard?

    public init(cardId: UUID, status: OwnedCardPriceStatus, price: PricedCard? = nil) {
        self.cardId = cardId
        self.status = status
        self.price = price
    }

    private enum CodingKeys: String, CodingKey {
        case status
        case price
        case cardId = "card_id"
    }
}

public struct OwnedCardPriceUpdate: Equatable, Sendable {
    public let updatedAt: Date
    public let price: OwnedCardPrice
    public let displayCurrency: Currency?
    public let illustrator: String?
    public let purchasePriceChangePercent: Double?
    public let purchases: [CardPurchase]

    public var cardID: UUID { price.cardId }
}
