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

    var values: CardFormValues {
        didSet {
            if values.game != oldValue.game || values.name != oldValue.name || values.cardNumber != oldValue.cardNumber
            {
                values.defaultMarketPrice = nil
                values.defaultMarketCurrency = nil
                values.marketPricedOn = nil
                values.pricingCardID = nil
                for index in values.batches.indices {
                    values.batches[index].applyDefaultPrice(nil, currency: values.preferredCurrency)
                }
            }
            revalidateIfNeeded()
        }
    }

    private(set) var fieldErrors: [TCGCardsValidationField: String] = [:]
    private(set) var isSubmitting = false
    private(set) var toast: String?
    private(set) var savedCard: CardWithPrice?
    var isShowingDiscardConfirmation = false
    private var initialValues: CardFormValues
    private var hasSubmitted = false
    private var currencyConfigured = false

    init(mode: Mode, initialValues: CardFormValues?) {
        self.mode = mode
        let initial: CardFormValues
        switch mode {
        case .add, .draft:
            initial =
                initialValues
                ?? CardFormValues(game: .onePiece, name: "", setName: "", cardNumber: "", notes: "", quantities: [:])
        case .edit(let card): initial = CardFormValues(card: card)
        }
        values = initial
        self.initialValues = initial
    }

    var canChooseCollection: Bool {
        switch mode {
        case .draft: false
        case .add, .edit: true
        }
    }

    func createCollection(name: String, using collections: TCGCollections) async -> Result<Void, CollectionsError> {
        switch await collections.create(name: name) {
        case .success(let collection):
            values.collectionID = collection.id
            return .success(())
        case .failure(let error):
            return .failure(error)
        }
    }

    func configureCollection(currentID: UUID?, unfiledID: UUID?) {
        let id: UUID?
        switch mode {
        case .add: id = currentID ?? unfiledID
        case .edit: id = values.collectionID ?? unfiledID
        case .draft: return
        }
        values.collectionID = id
        initialValues.collectionID = id
    }

    var hasUnsavedChanges: Bool {
        var current = values
        var initial = initialValues
        current.batches = current.batches.filter { $0.quantity != 0 }
        initial.batches = initial.batches.filter { $0.quantity != 0 }
        return current != initial
    }

    private struct PricingIdentity: Equatable {
        let game: ClientCardGame
        let name: String
        let cardNumber: String
    }

    private var pricingIdentity: PricingIdentity {
        PricingIdentity(game: values.game, name: values.name, cardNumber: values.cardNumber)
    }

    func refreshPurchaseDefault(using cards: TCGCards) async {
        if case .draft = mode { return }
        guard !values.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        guard !values.cardNumber.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .gmt
        if let date = values.marketPricedOn, calendar.isDateInToday(date) { return }
        let identity = pricingIdentity
        guard !Task.isCancelled else { return }
        let result = await cards.purchaseDefault(
            game: identity.game,
            name: identity.name,
            cardNumber: identity.cardNumber
        )
        guard !Task.isCancelled else { return }
        guard identity == pricingIdentity else { return }
        guard case .success(let matches) = result else { return }
        let match =
            values.pricingCardID.flatMap { id in matches.matches.first { $0.id == id } }
            ?? matches.matches.first {
                $0.cardNumber.caseInsensitiveCompare(identity.cardNumber) == .orderedSame
                    && $0.name.caseInsensitiveCompare(identity.name) == .orderedSame
            }
        guard let match else { return }
        applyMarketDefault(match)
    }

    func applyMarketDefault(_ card: PricedCard) {
        values.updateMarketDefault(card)
        applyBatchDefaults()
    }

    func configureCurrency(preferred: Currency, rates: ExchangeRates?) {
        if !currencyConfigured {
            values.preferredCurrency = preferred
            currencyConfigured = true
        }
        values.exchangeRates = rates
        guard case .add = mode else { return }
        applyBatchDefaults()
    }

    private func applyBatchDefaults() {
        let existingBatchIDs = Set(initialValues.batches.map(\.id))
        values.batches = values.batches.map { batch in
            if case .edit = mode, existingBatchIDs.contains(batch.id) { return batch }
            return values.applyingMarketDefault(to: batch)
        }
    }

    func addBatch(condition: CardCondition) {
        values.batches.append(values.newBatch(condition: condition))
    }

    func selectPurchaseCurrency(id: UUID, currency: Currency) {
        guard let index = values.batches.firstIndex(where: { $0.id == id }) else { return }
        guard values.batches[index].currency != currency else { return }
        var batch = values.batches[index]
        batch.currency = currency
        switch mode {
        case .add:
            batch.currencyWasSelected = true
            batch = values.applyingMarketDefault(to: batch)
        case .edit, .draft:
            batch.priceWasEdited = true
        }
        values.batches[index] = batch
    }

    func removeBatch(id: UUID) { values.batches.removeAll { $0.id == id } }

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
        case .draft: return false
        case .add: result = await cards.addCard(values)
        case .edit(let card):
            result = await cards.updateCard(id: card.id, values: values).map { savedCard = $0 }
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

    func saveDraft() -> CardFormValues? {
        hasSubmitted = true
        let issues = TCGCardsValidator.issues(for: values)
        apply(issues)
        guard issues.isEmpty else { return nil }
        return values
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
        case draft
        case edit(Card)

        var title: String {
            switch self {
            case .draft: String(localized: "Save Changes", bundle: .module)
            case .add: String(localized: "Add card", bundle: .module)
            case .edit: String(localized: "Edit card", bundle: .module)
            }
        }
    }
}
