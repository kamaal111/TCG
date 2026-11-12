//
//  CardWithPrice.swift
//  TCGClient
//

public struct CardWithPrice: Codable, Hashable, Sendable {
    public let card: Card
    public let price: OwnedCardPrice

    public init(card: Card, price: OwnedCardPrice) {
        self.card = card
        self.price = price
    }
}
