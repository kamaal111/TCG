//
//  CardGame.swift
//  TCGModels
//

import Foundation
import TCGClient

public enum CardGame: Hashable, Sendable, CaseIterable {
    case onePiece
    case pokemon

    public init(client: ClientCardGame) {
        switch client {
        case .onePiece: self = .onePiece
        case .pokemon: self = .pokemon
        }
    }

    public var title: String {
        switch self {
        case .onePiece: String(localized: "One Piece")
        case .pokemon: String(localized: "Pokémon")
        }
    }

    public var clientGame: ClientCardGame {
        switch self {
        case .onePiece: .onePiece
        case .pokemon: .pokemon
        }
    }
}
