//
//  TCGCardFormScreenModel.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/20/26.
//

import Observation
import TCGClient

@MainActor
@Observable
final class TCGCardFormScreenModel {

    let mode: Mode

    var values: CardFormValues {
        didSet { revalidateIfNeeded() }
    }

    private(set) var fieldErrors: [TCGCardsValidationField: String] = [:]
    private(set) var isSubmitting = false
    private(set) var toast: String?
    private var hasSubmitted = false

    init(mode: Mode) {
        self.mode = mode
        switch mode {
        case .add:
            values = CardFormValues(game: .onePiece, name: "", setName: "", cardNumber: "", notes: "", quantities: [:])
        case .edit(let card): values = CardFormValues(card: card)
        }
    }

    func submit(using cards: TCGCards) async -> Bool {
        guard !isSubmitting else { return false }

        hasSubmitted = true
        let issues = TCGCardsValidator.issues(for: values)
        guard issues.isEmpty else {
            apply(issues)
            toast = TCGCardsOperationError.validation(issues).errorDescription
            return false
        }

        isSubmitting = true
        defer { isSubmitting = false }
        let result: Result<Void, TCGCardsOperationError>
        switch mode {
        case .add: result = await cards.addCard(values)
        case .edit(let card): result = await cards.updateCard(id: card.id, values: values)
        }
        switch result {
        case .success:
            toast = nil
            return true
        case .failure(let error):
            if case .validation(let issues) = error { apply(issues) }
            toast = error.errorDescription
            return false
        }
    }

    private func revalidateIfNeeded() {
        guard hasSubmitted else { return }
        apply(TCGCardsValidator.issues(for: values))
    }

    private func apply(_ issues: [TCGCardsValidationIssue]) {
        fieldErrors = Dictionary(issues.map { ($0.field, $0.message) }, uniquingKeysWith: { first, _ in first })
    }

    enum Mode {
        case add
        case edit(Card)

        var title: String {
            switch self {
            case .add: String(localized: "Add card")
            case .edit: String(localized: "Edit card")
            }
        }
    }
}
