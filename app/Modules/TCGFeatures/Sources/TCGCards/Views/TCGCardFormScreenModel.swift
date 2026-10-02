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
    var isShowingDiscardConfirmation = false
    private let initialValues: CardFormValues
    private var hasSubmitted = false

    init(mode: Mode, initialValues: CardFormValues?) {
        self.mode = mode
        let initial: CardFormValues
        switch mode {
        case .add:
            initial =
                initialValues
                ?? CardFormValues(game: .onePiece, name: "", setName: "", cardNumber: "", notes: "", quantities: [:])
        case .edit(let card): initial = CardFormValues(card: card)
        }
        values = initial
        self.initialValues = initial
    }

    var hasUnsavedChanges: Bool {
        var current = values
        var initial = initialValues
        current.quantities = current.quantities.filter { $0.value != 0 }
        initial.quantities = initial.quantities.filter { $0.value != 0 }
        return current != initial
    }

    func requestDismissal() -> Bool {
        guard !isSubmitting else { return false }
        guard !hasUnsavedChanges else {
            isShowingDiscardConfirmation = true
            return false
        }
        return true
    }

    func keepEditing() {
        isShowingDiscardConfirmation = false
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
            case .add: String(localized: "Add card", bundle: .module)
            case .edit: String(localized: "Edit card", bundle: .module)
            }
        }
    }
}
