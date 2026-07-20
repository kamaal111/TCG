//
//  CardGame+Presentation.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/20/26.
//

import Foundation
import TCGClient

extension CardGame {
    var title: String {
        switch self {
        case .onePiece: String(localized: "One Piece")
        case .pokemon: String(localized: "Pokemon")
        }
    }
}
