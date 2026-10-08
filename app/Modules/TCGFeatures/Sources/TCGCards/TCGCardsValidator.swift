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
            textIssue(values.name, field: .name, label: String(localized: "Name"), maximum: 200),
            textIssue(values.setName, field: .setName, label: String(localized: "Set name"), maximum: 200),
            textIssue(values.cardNumber, field: .cardNumber, label: String(localized: "Card number"), maximum: 50),
            notesIssue(values.notes),
            quantitiesIssue(values.quantities),
            batchesIssue(values.batches),
        ].compactMap(\.self)
    }

    private static func textIssue(
        _ value: String,
        field: TCGCardsValidationField,
        label: String,
        maximum: Int
    ) -> TCGCardsValidationIssue? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return .init(field: field, message: "\(label) is required.") }
        guard trimmed.count <= maximum else {
            return .init(field: field, message: "\(label) must contain at most \(maximum) characters.")
        }
        return nil
    }

    private static func notesIssue(_ notes: String) -> TCGCardsValidationIssue? {
        guard notes.count <= 2_000 else {
            return .init(field: .notes, message: String(localized: "Notes must contain at most 2000 characters."))
        }
        return nil
    }

    private static func batchesIssue(_ batches: [PurchaseBatchFormValue]) -> TCGCardsValidationIssue? {
        guard batches.allSatisfy({ (1...999).contains($0.quantity) }) else {
            return .init(
                field: .purchases,
                message: String(localized: "Each batch must contain between 1 and 999 cards.", bundle: .module)
            )
        }
        guard
            batches.allSatisfy({
                $0.priceText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || $0.price != nil
            })
        else {
            return .init(
                field: .purchases,
                message: String(
                    localized: "Enter a nonnegative purchase price with at most six decimal places.",
                    bundle: .module
                )
            )
        }
        return nil
    }

    private static func quantitiesIssue(_ quantities: [CardCondition: Int]) -> TCGCardsValidationIssue? {
        let values = quantities.values
        guard values.allSatisfy({ (0...999).contains($0) }) else {
            return .init(field: .quantities, message: String(localized: "Each quantity must be between 0 and 999."))
        }
        guard values.contains(where: { $0 >= 1 }) else {
            return .init(field: .quantities, message: String(localized: "Add at least one card quantity."))
        }
        return nil
    }
}
