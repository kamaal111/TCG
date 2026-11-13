//
//  UpsertCardPayload.swift
//  TCGClient
//
//  Created by Kamaal M Farah on 7/20/26.
//

import Foundation

public struct UpsertCardPayload: Codable, Equatable, Sendable {
    public var collectionID: UUID?
    public let game: ClientCardGame
    public let name: String
    public let setName: String
    public let cardNumber: String
    public let notes: String?
    public let purchases: [CardPurchase]
    public let pricedCardID: UUID?

    public init(
        game: ClientCardGame,
        name: String,
        setName: String,
        cardNumber: String,
        notes: String?,
        purchases: [CardPurchase],
        collectionID: UUID?,
        pricedCardID: UUID? = nil
    ) {
        self.collectionID = collectionID
        self.game = game
        self.name = name
        self.setName = setName
        self.cardNumber = cardNumber
        self.notes = notes
        self.purchases = purchases
        self.pricedCardID = pricedCardID
    }

    private enum CodingKeys: String, CodingKey {
        case collectionID = "collection_id"
        case game
        case name
        case notes
        case purchases
        case pricedCardID = "priced_card_id"
        case setName = "set_name"
        case cardNumber = "card_number"
    }
}
