//
//  TCGCardFormScreenModel.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/20/26.
//

import Foundation
import Observation
import TCGClient

@MainActor
@Observable
final class TCGCardFormScreenModel {
    let mode: Mode

    var game: CardGame {
        didSet { revalidateIfNeeded() }
    }
    var name: String {
        didSet { revalidateIfNeeded() }
    }
    var setName: String {
        didSet { revalidateIfNeeded() }
    }
    var cardNumber: String {
        didSet { revalidateIfNeeded() }
    }
    var notes: String {
        didSet { revalidateIfNeeded() }
    }

    private(set) var quantities: [CardCondition: Int]
    private(set) var fieldErrors: [TCGCardsValidationField: String] = [:]
    private(set) var isSubmitting = false
    private(set) var toast: Toast?

    @ObservationIgnored
    private var hasAttemptedSubmit = false
    @ObservationIgnored
    private var toastDismissalTask: Task<Void, Never>?

    init(mode: Mode) {
        self.mode = mode
        let values =
            switch mode {
            case .add: CardFormValues()
            case .edit(let card): CardFormValues(card: card)
            }
        self.game = values.game
        self.name = values.name
        self.setName = values.setName
        self.cardNumber = values.cardNumber
        self.notes = values.notes
        self.quantities = values.quantities
    }

    var title: String {
        switch mode {
        case .add: String(localized: "Add Card")
        case .edit: String(localized: "Edit Card")
        }
    }

    func quantity(for condition: CardCondition) -> Int {
        quantities[condition] ?? 0
    }

    func setQuantity(_ quantity: Int, for condition: CardCondition) {
        quantities[condition] = quantity
        revalidateIfNeeded()
    }

    func submit(using cards: TCGCards) async -> Bool {
        guard !isSubmitting else { return false }

        hasAttemptedSubmit = true
        let validationIssues = TCGCardsValidator.issues(for: formValues)
        if !validationIssues.isEmpty {
            applyFieldErrors(from: validationIssues)
            showErrorToast(message: TCGCardsOperationError.validation(validationIssues).errorDescription)
            return false
        }
        fieldErrors = [:]

        isSubmitting = true
        defer { isSubmitting = false }

        let result: Result<Void, TCGCardsOperationError>
        switch mode {
        case .add:
            result = await cards.addCard(formValues)
        case .edit(let card):
            result = await cards.updateCard(id: card.id, values: formValues)
        }

        switch result {
        case .failure(let error):
            if case .validation(let issues) = error {
                applyFieldErrors(from: issues)
            }
            showErrorToast(message: error.errorDescription)
            return false
        case .success:
            dismissToast()
            return true
        }
    }

    func dismissToast() {
        toastDismissalTask?.cancel()
        toastDismissalTask = nil
        toast = nil
    }

    private var formValues: CardFormValues {
        CardFormValues(
            game: game,
            name: name,
            setName: setName,
            cardNumber: cardNumber,
            notes: notes,
            quantities: quantities
        )
    }

    private func revalidateIfNeeded() {
        guard hasAttemptedSubmit else { return }

        applyFieldErrors(from: TCGCardsValidator.issues(for: formValues))
    }

    private func applyFieldErrors(from issues: [TCGCardsValidationIssue]) {
        fieldErrors = Dictionary(issues.map { ($0.field, $0.message) }, uniquingKeysWith: { first, _ in first })
    }

    private func showErrorToast(message: String) {
        toastDismissalTask?.cancel()
        toast = Toast(title: String(localized: "Card could not be saved"), message: message)
        toastDismissalTask = Task {
            try? await Task.sleep(for: ModuleConfig.toastDismissalDelay)
            guard !Task.isCancelled else { return }
            toast = nil
        }
    }

    enum Mode {
        case add
        case edit(Card)
    }

    struct Toast: Equatable {
        let title: String
        let message: String
    }
}
