//
//  TCGCardsValidator.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/20/26.
//

import Foundation
import TCGClient

enum TCGCardsValidator {
    static func issues(for values: CardFormValues) -> [TCGCardsValidationIssue] {
        [
            nameIssue(values.name),
            setNameIssue(values.setName),
            cardNumberIssue(values.cardNumber),
            notesIssue(values.notes),
            quantitiesIssue(values.quantities),
        ].compactMap(\.self)
    }

    static func nameIssue(_ name: String) -> TCGCardsValidationIssue? {
        textIssue(name, field: .name, maximumLength: 200, emptyMessage: String(localized: "Enter the card name."))
    }

    static func setNameIssue(_ setName: String) -> TCGCardsValidationIssue? {
        textIssue(setName, field: .setName, maximumLength: 200, emptyMessage: String(localized: "Enter the set name."))
    }

    static func cardNumberIssue(_ cardNumber: String) -> TCGCardsValidationIssue? {
        textIssue(
            cardNumber,
            field: .cardNumber,
            maximumLength: 50,
            emptyMessage: String(localized: "Enter the card number.")
        )
    }

    static func notesIssue(_ notes: String) -> TCGCardsValidationIssue? {
        guard notes.utf16.count <= 2000 else {
            return TCGCardsValidationIssue(
                field: .notes,
                message: String(localized: "Notes must contain at most 2000 characters.")
            )
        }

        return nil
    }

    static func quantitiesIssue(_ quantities: [CardCondition: Int]) -> TCGCardsValidationIssue? {
        guard quantities.contains(where: { _, quantity in quantity >= 1 }) else {
            return TCGCardsValidationIssue(
                field: .quantities,
                message: String(localized: "Add at least one copy in any condition.")
            )
        }

        guard quantities.allSatisfy({ _, quantity in (0...999).contains(quantity) }) else {
            return TCGCardsValidationIssue(
                field: .quantities,
                message: String(localized: "Quantities must be between 0 and 999.")
            )
        }

        return nil
    }

    private static func textIssue(
        _ value: String,
        field: TCGCardsValidationField,
        maximumLength: Int,
        emptyMessage: String
    ) -> TCGCardsValidationIssue? {
        let trimmedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedValue.isEmpty else {
            return TCGCardsValidationIssue(field: field, message: emptyMessage)
        }

        guard trimmedValue.utf16.count <= maximumLength else {
            return TCGCardsValidationIssue(
                field: field,
                message: String(localized: "Must contain at most \(maximumLength) characters.")
            )
        }

        return nil
    }
}
