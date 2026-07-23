//
//  OwnedCardPrice.swift
//  TCGClient
//

import Foundation

public enum OwnedCardPriceStatus: String, Codable, Hashable, Sendable {
    case priced
    case noMatch = "no_match"
    case noPrice = "no_price"
}

public struct OwnedCardPrice: Codable, Hashable, Sendable {
    public let cardId: String
    public let status: OwnedCardPriceStatus
    public let price: PricedCard?

    public init(cardId: String, status: OwnedCardPriceStatus, price: PricedCard? = nil) {
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
