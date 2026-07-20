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

    private enum CodingKeys: String, CodingKey {
        case id
        case game
        case name
        case notes
        case quantities
        case setName = "set_name"
        case cardNumber = "card_number"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}
