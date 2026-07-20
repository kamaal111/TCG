//
//  Card.swift
//  TCGClient
//
//  Created by Kamaal M Farah on 7/20/26.
//

import Foundation

public enum CardGame: String, Codable, Hashable, Sendable, CaseIterable {
    case onePiece = "one_piece"
    case pokemon
}

public enum CardCondition: String, Codable, Hashable, Sendable, CaseIterable {
    case mint
    case nearMint = "near_mint"
    case excellent
    case good
    case played
    case damaged
}

public struct CardConditionQuantity: Codable, Hashable, Sendable {
    public let condition: CardCondition
    public let quantity: Int

    public init(condition: CardCondition, quantity: Int) {
        self.condition = condition
        self.quantity = quantity
    }
}

public struct Card: Codable, Hashable, Identifiable, Sendable {
    public let id: String
    public let game: CardGame
    public let name: String
    public let setName: String
    public let cardNumber: String
    public let notes: String?
    public let quantities: [CardConditionQuantity]
    public let createdAt: Date
    public let updatedAt: Date

    public init(
        id: String,
        game: CardGame,
        name: String,
        setName: String,
        cardNumber: String,
        notes: String?,
        quantities: [CardConditionQuantity],
        createdAt: Date,
        updatedAt: Date
    ) {
        self.id = id
        self.game = game
        self.name = name
        self.setName = setName
        self.cardNumber = cardNumber
        self.notes = notes
        self.quantities = quantities
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    public var totalQuantity: Int {
        quantities.reduce(0) { result, quantity in result + quantity.quantity }
    }
}
