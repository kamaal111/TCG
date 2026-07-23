//
//  CardWithPrice.swift
//  TCGClient
//

public struct CardWithPrice: Hashable, Sendable {
    public let card: Card
    public let price: OwnedCardPrice

    public init(card: Card, price: OwnedCardPrice) {
        self.card = card
        self.price = price
    }
}
