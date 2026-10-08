//
//  UpsertCardPayload.swift
//  TCGClient
//
//  Created by Kamaal M Farah on 7/20/26.
//

public struct UpsertCardPayload: Codable, Equatable, Sendable {
    public let game: ClientCardGame
    public let name: String
    public let setName: String
    public let cardNumber: String
    public let notes: String?
    public let purchases: [CardPurchase]

    public init(
        game: ClientCardGame,
        name: String,
        setName: String,
        cardNumber: String,
        notes: String?,
        purchases: [CardPurchase]
    ) {
        self.game = game
        self.name = name
        self.setName = setName
        self.cardNumber = cardNumber
        self.notes = notes
        self.purchases = purchases
    }

    private enum CodingKeys: String, CodingKey {
        case game
        case name
        case notes
        case purchases
        case setName = "set_name"
        case cardNumber = "card_number"
    }
}
