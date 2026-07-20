//
//  CardFormValues.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/20/26.
//

import Foundation
import TCGClient

struct CardFormValues: Equatable {
    var game: CardGame
    var name: String
    var setName: String
    var cardNumber: String
    var notes: String
    var quantities: [CardCondition: Int]

    init(
        game: CardGame, name: String, setName: String, cardNumber: String, notes: String,
        quantities: [CardCondition: Int]
    ) {
        self.game = game
        self.name = name
        self.setName = setName
        self.cardNumber = cardNumber
        self.notes = notes
        self.quantities = quantities
    }

    init(card: Card) {
        game = card.game
        name = card.name
        setName = card.setName
        cardNumber = card.cardNumber
        notes = card.notes ?? ""
        quantities = Dictionary(uniqueKeysWithValues: card.quantities.map { ($0.condition, $0.quantity) })
    }

    var payload: UpsertCardPayload {
        UpsertCardPayload(
            game: game,
            name: name.trimmingCharacters(in: .whitespacesAndNewlines),
            setName: setName.trimmingCharacters(in: .whitespacesAndNewlines),
            cardNumber: cardNumber.trimmingCharacters(in: .whitespacesAndNewlines),
            notes: trimmedNotes.isEmpty ? nil : trimmedNotes,
            quantities: CardCondition.allCases.compactMap { condition in
                guard let quantity = quantities[condition] else { return nil }
                guard quantity > 0 else { return nil }
                return CardConditionQuantity(condition: condition, quantity: quantity)
            }
        )
    }

    private var trimmedNotes: String { notes.trimmingCharacters(in: .whitespacesAndNewlines) }
}
