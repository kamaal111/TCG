//
//  TCGCardFormScreenModelTests.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/20/26.
//

import Foundation
import HTTPTypes
import KamaalAuth
import OpenAPIRuntime
import Testing

@testable import TCGCards
@testable import TCGClient

@Suite("TCGCard Form Screen Model Tests")
@MainActor
struct TCGCardFormScreenModelTests {
    @Test
    func `Selecting JPY converts the automatic price and saved purchase`() throws {
        let model = makeCurrencySelectionModel()
        model.values.batches[0].quantity = 2
        let id = model.values.batches[0].id
        model.selectPurchaseCurrency(id: id, currency: .jpy)
        let batch = model.values.batches[0]
        let price = try #require(batch.price)
        #expect(batch.priceText == "42600")
        #expect(batch.currency == .jpy)
        #expect(price * Decimal(batch.quantity) == 85200)
        #expect(model.values.payload.purchases.first?.purchasePrice == 42600)
        #expect(model.values.payload.purchases.first?.currency == .jpy)
        #expect(TCGCardsValidator.issues(for: model.values).isEmpty)
    }

    @Test
    func `Repeated currency selections use the original market amount`() {
        let model = makeCurrencySelectionModel()
        let id = model.values.batches[0].id
        model.selectPurchaseCurrency(id: id, currency: .jpy)
        #expect(model.values.batches[0].price == 42600)
        model.selectPurchaseCurrency(id: id, currency: .eur)
        #expect(model.values.batches[0].price == Decimal(string: "227.2"))
        model.selectPurchaseCurrency(id: id, currency: .usd)
        #expect(model.values.batches[0].price == 284)
        model.values.defaultMarketPrice = 1
        model.configureCurrency(preferred: .usd, rates: ExchangeRates(date: "2026-10-16", rates: ["USD": 3, "EUR": 1]))
        model.selectPurchaseCurrency(id: id, currency: .eur)
        #expect(model.values.batches[0].priceText == "0.333333")
        model.selectPurchaseCurrency(id: id, currency: .usd)
        #expect(model.values.batches[0].priceText == "1")
    }

    @Test(arguments: ["300", "", "1.2345678"])
    func `Currency selection and refresh preserve manually edited text`(text: String) {
        let model = makeCurrencySelectionModel()
        let id = model.values.batches[0].id
        model.values.batches[0].priceText = text
        model.values.batches[0].priceWasEdited = true
        model.selectPurchaseCurrency(id: id, currency: .jpy)
        model.configureCurrency(preferred: .usd, rates: nil)
        model.applyMarketDefault(PreviewTCGPricingClient.samplePricedCards[0])
        #expect(model.values.batches[0].priceText == text)
        #expect(model.values.batches[0].currency == .jpy)
    }

    @Test(
        arguments: [
            nil,
            ExchangeRates(date: "2026-10-16", rates: ["USD": 1]),
            ExchangeRates(date: "2026-10-16", rates: ["JPY": 150]),
            ExchangeRates(date: "2026-10-16", rates: ["USD": 0, "JPY": 150]),
            ExchangeRates(date: "2026-10-16", rates: ["USD": 1, "JPY": -1]),
        ] as [ExchangeRates?]
    )
    func `Unavailable conversion clears automatic price and rate recovery restores selected currency`(
        rates: ExchangeRates?
    ) throws {
        let model = makeCurrencySelectionModel()
        model.configureCurrency(preferred: .usd, rates: rates)
        let id = model.values.batches[0].id
        model.selectPurchaseCurrency(id: id, currency: .jpy)
        #expect(model.values.batches[0].currency == .jpy)
        #expect(model.values.batches[0].priceText.isEmpty)
        let purchase = try #require(model.values.payload.purchases.first)
        #expect(purchase.purchasePrice == nil)
        #expect(purchase.currency == nil)
        model.configureCurrency(preferred: .usd, rates: currencySelectionRates)
        #expect(model.values.batches[0].currency == .jpy)
        #expect(model.values.batches[0].price == 42600)
    }

    @Test
    func `Manual entry after failed conversion survives rate recovery`() {
        let model = makeCurrencySelectionModel()
        model.configureCurrency(preferred: .usd, rates: nil)
        model.selectPurchaseCurrency(id: model.values.batches[0].id, currency: .jpy)
        model.values.batches[0].priceText = "500"
        model.values.batches[0].priceWasEdited = true
        model.configureCurrency(preferred: .usd, rates: currencySelectionRates)
        #expect(model.values.batches[0].price == 500)
        #expect(model.values.batches[0].currency == .jpy)
    }

    @Test
    func `Currency selections affect only one batch and survive market refresh`() {
        let model = makeCurrencySelectionModel()
        model.addBatch(condition: .played)
        let other = model.values.batches[1]
        let id = model.values.batches[0].id
        model.selectPurchaseCurrency(id: id, currency: .jpy)
        #expect(model.values.batches[1] == other)
        model.addBatch(condition: .mint)
        #expect(model.values.batches[2].currency == .usd)
        #expect(model.values.batches[2].price == 284)
        model.applyMarketDefault(PreviewTCGPricingClient.samplePricedCards[0])
        #expect(model.values.batches[0].currency == .jpy)
        #expect(model.values.batches[0].price == model.values.defaultMarketPrice.map { $0 * 150 })
        model.values.name = "Different card"
        #expect(model.values.batches[0].priceText.isEmpty)
        #expect(model.values.batches[0].currency == .jpy)
    }

    @Test
    func `Selecting current currency or an unknown batch leaves automatic defaults active`() {
        let model = makeCurrencySelectionModel()
        let original = model.values.batches
        model.selectPurchaseCurrency(id: UUID(), currency: .jpy)
        model.selectPurchaseCurrency(id: model.values.batches[0].id, currency: .usd)
        #expect(model.values.batches == original)
        model.values.defaultMarketPrice = 300
        model.configureCurrency(preferred: .usd, rates: currencySelectionRates)
        #expect(model.values.batches[0].price == 300)
    }

    @Test(arguments: [
        TCGCardFormScreenModel.Mode.edit(PreviewTCGCardsClient.sampleCards[0]),
        TCGCardFormScreenModel.Mode.draft,
    ])
    func `Edit and draft currency selections preserve the price and prevent future defaults`(
        mode: TCGCardFormScreenModel.Mode
    ) {
        let model = TCGCardFormScreenModel(mode: mode, initialValues: validValues)
        let id = model.values.batches[0].id
        model.values.batches[0].priceText = "284"
        model.values.batches[0].currency = .usd
        model.selectPurchaseCurrency(id: id, currency: .jpy)
        model.applyMarketDefault(PreviewTCGPricingClient.samplePricedCards[0])
        #expect(model.values.batches[0].price == 284)
        #expect(model.values.batches[0].currency == .jpy)
    }

    private var currencySelectionRates: ExchangeRates {
        ExchangeRates(date: "2026-10-16", rates: ["USD": 1, "JPY": 150, "EUR": Decimal(8) / 10])
    }

    private func makeCurrencySelectionModel() -> TCGCardFormScreenModel {
        let model = TCGCardFormScreenModel(mode: .add, initialValues: validValues)
        model.values.defaultMarketPrice = 284
        model.values.defaultMarketCurrency = .usd
        model.configureCurrency(preferred: .usd, rates: currencySelectionRates)
        return model
    }

    @Test(arguments: [
        ("10", "1.9", "5.263158"),
        ("5.13640806895938860748244912467786368", "1", "5.136408"),
        ("9.9999999", "1", "10"),
        ("0.0000004", "1", "0"),
        ("1.234567", "1", "1.234567"),
        ("1.2345665", "1", "1.234567"),
    ])
    func `Converted defaults fit purchase precision for existing and new batches`(scenario: (String, String, String))
        throws
    {
        let (source, rate, expectedText) = scenario
        let sourcePrice = try #require(Decimal(string: source))
        let model = TCGCardFormScreenModel(mode: .add, initialValues: validValues)
        model.values.defaultMarketPrice = sourcePrice
        model.values.defaultMarketCurrency = .usd
        model.configureCurrency(
            preferred: .eur,
            rates: ExchangeRates(date: "2026-10-16", rates: ["EUR": 1, "USD": try #require(Decimal(string: rate))])
        )
        model.addBatch(condition: .played)
        let expectedPrice = try #require(Decimal(string: expectedText))
        #expect(model.values.batches.map(\.priceText) == [expectedText, expectedText])
        #expect(model.values.payload.purchases.map(\.purchasePrice) == [expectedPrice, expectedPrice])
        #expect(model.values.payload.purchases.map(\.currency) == [.eur, .eur])
        #expect(TCGCardsValidator.issues(for: model.values).isEmpty)
    }

    @Test
    func `Currency refresh preserves and rejects manually entered prices beyond six decimals`() {
        let model = TCGCardFormScreenModel(mode: .add, initialValues: validValues)
        model.values.batches[0].priceText = "1.2345678"
        model.values.batches[0].priceWasEdited = true
        model.values.defaultMarketPrice = 10
        model.values.defaultMarketCurrency = .usd
        model.configureCurrency(
            preferred: .eur,
            rates: ExchangeRates(date: "2026-10-16", rates: ["EUR": 1, "USD": 1.9])
        )
        #expect(model.values.batches[0].priceText == "1.2345678")
        #expect(TCGCardsValidator.issues(for: model.values).map(\.field) == [.purchases])
    }

    @Test
    func `Converted purchase defaults save six decimal prices through the generated client`() async throws {
        let model = TCGCardFormScreenModel(mode: .add, initialValues: validValues)
        model.values.defaultMarketPrice = 10
        model.values.defaultMarketCurrency = .usd
        model.configureCurrency(
            preferred: .eur,
            rates: ExchangeRates(date: "2026-10-16", rates: ["EUR": 1, "USD": 1.9])
        )
        let transport = PurchaseSaveTransport()
        let saved = try await makeClient(transport: transport).cards.create(with: model.values.payload).get()
        let body = try #require(await transport.requestBody)
        let sent = try JSONDecoder().decode(Components.Schemas.UpsertCard.self, from: body)
        let purchase = try #require(sent.purchases.first)
        #expect(purchase.purchasePrice == "5.263158")
        #expect(purchase.currency?.rawValue == "EUR")
        #expect(saved.card.purchases.first?.purchasePrice == Decimal(string: "5.263158"))
        #expect(TCGCardsValidator.issues(for: model.values).isEmpty)
    }

    @Test
    func `Market defaults return a converted batch without changing the original`() {
        let model = TCGCardFormScreenModel(mode: .add, initialValues: nil)
        model.configureCurrency(
            preferred: .eur,
            rates: ExchangeRates(date: "2026-10-16", rates: ["EUR": 1, "USD": 1.25])
        )
        model.values.defaultMarketPrice = 12.5
        model.values.defaultMarketCurrency = .usd
        let original = PurchaseBatchFormValue(condition: .nearMint, quantity: 2, currency: .usd)
        let updated = model.values.applyingMarketDefault(to: original)
        #expect(original.priceText.isEmpty)
        #expect(original.currency == .usd)
        #expect(updated.id == original.id)
        #expect(updated.quantity == 2)
        #expect(updated.currency == .eur)
        #expect(updated.price == 10)
    }

    @Test
    func `Defaults new purchases to EUR and preserves manual JPY overrides`() {
        let model = TCGCardFormScreenModel(mode: .add, initialValues: nil)
        model.configureCurrency(
            preferred: .eur,
            rates: ExchangeRates(date: "2026-10-16", rates: ["EUR": 1, "USD": 1.25, "JPY": 150])
        )
        model.values.defaultMarketPrice = 12.5
        model.values.defaultMarketCurrency = .usd
        model.addBatch(condition: .nearMint)
        #expect(model.values.batches[0].currency == .eur)
        #expect(model.values.batches[0].price == 10)
        model.values.batches[0].currency = .jpy
        model.values.batches[0].priceText = "1500"
        model.values.batches[0].priceWasEdited = true
        model.configureCurrency(preferred: .eur, rates: nil)
        #expect(model.values.batches[0].currency == .jpy)
        #expect(model.values.batches[0].price == 1500)
        model.applyMarketDefault(PreviewTCGPricingClient.samplePricedCards[0])
        #expect(model.values.batches[0].currency == .jpy)
        #expect(model.values.batches[0].price == 1500)
    }

    @Test
    func `Currency and market refreshes preserve existing edit batches and convert new ones`() {
        let card = PreviewTCGPricingClient.samplePricedCards[0]
        let model = TCGCardFormScreenModel(mode: .edit(PreviewTCGCardsClient.sampleCards[0]), initialValues: nil)
        let originalBatches = model.values.batches
        let rates = ExchangeRates(date: "2026-10-16", rates: ["EUR": 1, "USD": 1.25, "JPY": 150])
        model.configureCurrency(preferred: .eur, rates: rates)
        model.applyMarketDefault(card)
        #expect(model.values.batches == originalBatches)
        model.addBatch(condition: .nearMint)
        let expectedPrice = model.values.batches.last?.price
        #expect(expectedPrice != nil)
        #expect(model.values.batches.last?.currency == .eur)
        model.applyMarketDefault(card)
        #expect(Array(model.values.batches.dropLast()) == originalBatches)
        #expect(model.values.batches.last?.price == expectedPrice)
    }

    @Test(arguments: PreviewTCGPricingClient.samplePricedCards)
    func `Searched cards prefill details with empty quantities and notes`(card: PricedCard) {
        let model = TCGCardFormScreenModel(mode: .add, initialValues: .init(pricedCard: card))
        #expect(model.values.game == card.game)
        #expect(model.values.name == card.name)
        #expect(model.values.setName == card.setName)
        #expect(model.values.cardNumber == card.cardNumber)
        #expect(model.values.quantities.isEmpty)
        #expect(model.values.notes.isEmpty)
    }

    @Test(arguments: PreviewTCGPricingClient.samplePricedCards)
    func `Searched card details are the dismissal baseline`(card: PricedCard) {
        let model = TCGCardFormScreenModel(mode: .add, initialValues: .init(pricedCard: card))
        #expect(!model.hasUnsavedChanges)
        #expect(model.requestDismissal())
        model.values.name = "Edited name"
        #expect(!model.requestDismissal())
        #expect(model.isShowingDiscardConfirmation)
        model.keepEditing()
        model.values.name = card.name
        #expect(!model.hasUnsavedChanges)
        #expect(model.requestDismissal())
    }

    @Test(arguments: PreviewTCGPricingClient.samplePricedCards)
    func `Searched cards require a quantity before saving`(card: PricedCard) async {
        let model = TCGCardFormScreenModel(mode: .add, initialValues: .init(pricedCard: card))
        let collection = TCGCards(client: .preview(cardsOutcome: .empty))
        #expect(!(await model.submit(using: collection)))
        #expect(Set(model.fieldErrors.keys) == [.quantities])
        #expect(collection.cards.isEmpty)
    }

    @Test
    func `Missing searched set remains required and can be supplied`() async {
        let card = PricedCard(
            id: "missing-set",
            game: .pokemon,
            name: "Pikachu",
            cardNumber: "58/102",
            pricedOn: .distantPast,
            fetchedAt: .distantPast
        )
        let model = TCGCardFormScreenModel(mode: .add, initialValues: .init(pricedCard: card))
        let collection = TCGCards(client: .preview(cardsOutcome: .empty))
        model.values.quantities = [.nearMint: 1]
        #expect(model.values.setName.isEmpty)
        #expect(!(await model.submit(using: collection)))
        #expect(Set(model.fieldErrors.keys) == [.setName])
        model.values.setName = "Base Set"
        #expect(await model.submit(using: collection))
        #expect(collection.cards.first?.card.setName == "Base Set")
    }

    @Test(arguments: PreviewTCGPricingClient.samplePricedCards)
    func `Prefilled add saves edited details quantities and notes`(card: PricedCard) async throws {
        let model = TCGCardFormScreenModel(mode: .add, initialValues: .init(pricedCard: card))
        let collection = TCGCards(client: .preview(cardsOutcome: .empty))
        model.values.name = "Corrected name"
        model.values.quantities = [.nearMint: 2, .played: 1]
        model.values.notes = "  My notes  "
        #expect(await model.submit(using: collection))
        let saved = try #require(collection.cards.first?.card)
        #expect(saved.game == card.game)
        #expect(saved.name == "Corrected name")
        #expect(saved.setName == card.setName)
        #expect(saved.cardNumber == card.cardNumber)
        #expect(saved.notes == "My notes")
        #expect(
            Set(saved.quantities)
                == Set([
                    CardConditionQuantity(condition: .nearMint, quantity: 2),
                    CardConditionQuantity(condition: .played, quantity: 1),
                ])
        )
    }

    @Test
    func `Prefilled add retains values after server failure`() async {
        let model = TCGCardFormScreenModel(
            mode: .add,
            initialValues: .init(pricedCard: PreviewTCGPricingClient.samplePricedCards[0])
        )
        model.values.quantities = [.nearMint: 1]
        model.values.notes = "Keep this draft"
        let values = model.values
        #expect(!(await model.submit(using: TCGCards(client: .preview(cardsOutcome: .serverUnavailable)))))
        #expect(model.values == values)
        #expect(model.toast != nil)
        #expect(!model.isSubmitting)
    }

    @Test
    func `Unchanged add and edit forms dismiss without confirmation`() {
        let add = TCGCardFormScreenModel(mode: .add, initialValues: nil)
        let edit = TCGCardFormScreenModel(mode: .edit(PreviewTCGCardsClient.sampleCards[0]), initialValues: nil)
        #expect(add.requestDismissal())
        #expect(edit.requestDismissal())
        #expect(!add.isShowingDiscardConfirmation)
        #expect(!edit.isShowingDiscardConfirmation)
    }

    @Test(arguments: ChangedTextField.allCases)
    func `Changed text fields require discard confirmation`(field: ChangedTextField) {
        let model = TCGCardFormScreenModel(mode: .add, initialValues: nil)
        model.values[keyPath: field.keyPath] = "Draft"
        #expect(model.hasUnsavedChanges)
        #expect(!model.requestDismissal())
        #expect(model.isShowingDiscardConfirmation)
    }

    @Test
    func `Changed game requires discard confirmation`() {
        let model = TCGCardFormScreenModel(mode: .add, initialValues: nil)
        model.values.game = .pokemon
        #expect(model.hasUnsavedChanges)
        #expect(!model.requestDismissal())
        #expect(model.isShowingDiscardConfirmation)
    }

    @Test
    func `Changed edit quantity requires discard confirmation`() {
        let model = TCGCardFormScreenModel(mode: .edit(PreviewTCGCardsClient.sampleCards[0]), initialValues: nil)
        model.values.quantities[.nearMint] = 3
        #expect(model.hasUnsavedChanges)
        #expect(!model.requestDismissal())
        #expect(model.isShowingDiscardConfirmation)
    }

    @Test
    func `Restoring every field permits immediate dismissal`() {
        let model = TCGCardFormScreenModel(mode: .edit(PreviewTCGCardsClient.sampleCards[0]), initialValues: nil)
        let original = model.values
        model.values = validValues
        #expect(model.hasUnsavedChanges)
        model.values = original
        #expect(!model.hasUnsavedChanges)
        #expect(model.requestDismissal())
    }

    @Test
    func `Zero quantities match missing quantities`() {
        let model = TCGCardFormScreenModel(mode: .add, initialValues: nil)
        model.values.quantities[.nearMint] = 1
        #expect(model.hasUnsavedChanges)
        model.values.quantities[.nearMint] = 0
        #expect(!model.hasUnsavedChanges)
        #expect(model.requestDismissal())
    }

    @Test
    func `Keeping edits preserves the draft and validation errors`() async {
        let model = TCGCardFormScreenModel(mode: .add, initialValues: nil)
        model.values.name = "Draft"
        let submitted = await model.submit(using: TCGCards(client: .preview(cardsOutcome: .empty)))
        #expect(!submitted)
        let draft = model.values
        let errors = model.fieldErrors
        let toast = model.toast
        #expect(!model.requestDismissal())
        model.keepEditing()
        #expect(!model.isShowingDiscardConfirmation)
        #expect(model.values == draft)
        #expect(model.fieldErrors == errors)
        #expect(model.toast == toast)
    }

    @Test
    func `Submission blocks repeated saves and dismissal and preserves edits on failure`() async throws {
        let transport = PendingCardSubmissionTransport()
        let client = try makeClient(transport: transport)
        let model = TCGCardFormScreenModel(mode: .add, initialValues: nil)
        model.values = validValues
        let submission = Task { await model.submit(using: TCGCards(client: client)) }
        await transport.waitForRequest()
        #expect(model.isSubmitting)
        #expect(!(await model.submit(using: TCGCards(client: client))))
        #expect(!model.requestDismissal())
        #expect(!model.isShowingDiscardConfirmation)
        await transport.failRequest()
        let submitted = await submission.value
        #expect(!submitted)
        #expect(!model.isSubmitting)
        #expect(model.values == validValues)
        #expect(model.hasUnsavedChanges)
        #expect(!model.requestDismissal())
        #expect(model.isShowingDiscardConfirmation)
    }

    @Test
    func `Empty fields and quantities are validated`() async {
        let model = TCGCardFormScreenModel(mode: .add, initialValues: nil)
        let submitted = await model.submit(using: TCGCards(client: .preview(cardsOutcome: .empty)))
        #expect(!submitted)
        #expect(model.fieldErrors[.name] != nil)
        #expect(model.fieldErrors[.setName] != nil)
        #expect(model.fieldErrors[.cardNumber] != nil)
        #expect(model.fieldErrors[.quantities] != nil)
        #expect(!model.isSubmitting)
    }

    @Test
    func `Valid add submits successfully`() async {
        let model = TCGCardFormScreenModel(mode: .add, initialValues: nil)
        model.values = validValues
        #expect(await model.submit(using: TCGCards(client: .preview(cardsOutcome: .empty))))
        #expect(!model.isSubmitting)
    }

    @Test
    func `Edit prefills every card value`() {
        let card = PreviewTCGCardsClient.sampleCards[0]
        let model = TCGCardFormScreenModel(mode: .edit(card), initialValues: nil)
        #expect(model.values.name == card.name)
        #expect(model.values.quantities[.nearMint] == 2)
    }

    @Test
    func `Server validation maps set name and unavailable sets toast`() async {
        let issue = TCGClientValidationIssue(code: "too_small", path: ["set_name"], message: "Required")
        let validationModel = TCGCardFormScreenModel(mode: .add, initialValues: nil)
        validationModel.values = validValues
        _ = await validationModel.submit(
            using: TCGCards(client: .preview(cardsOutcome: .validationErrors([issue])))
        )
        #expect(validationModel.fieldErrors[.setName] == "Required")

        let unavailableModel = TCGCardFormScreenModel(mode: .add, initialValues: nil)
        unavailableModel.values = validValues
        _ = await unavailableModel.submit(using: TCGCards(client: .preview(cardsOutcome: .serverUnavailable)))
        #expect(unavailableModel.toast != nil)
        #expect(!unavailableModel.isSubmitting)
    }

    @Test
    func `New batches prefill the average instead of the lowest price`() throws {
        let card = PreviewTCGPricingClient.samplePricedCards[0]
        let model = TCGCardFormScreenModel(mode: .add, initialValues: .init(pricedCard: card))
        model.addBatch(condition: .played)
        let batch = try #require(model.values.batches.first)
        let average = try #require(card.market?.market)
        #expect(batch.price == Decimal(string: String(format: "%.6f", average)))
        #expect(batch.currency == card.market?.currency)
        #expect(model.values.payload.purchases.first?.quantity == 1)
    }

    @Test
    func `Multiple purchases in one condition retain individual costs and aggregate quantities`() {
        let model = TCGCardFormScreenModel(mode: .add, initialValues: validValues)
        model.values.batches = [
            .init(condition: .nearMint, quantity: 2, priceText: "2"),
            .init(condition: .nearMint, quantity: 3, priceText: "4"),
        ]
        #expect(model.values.quantities == [.nearMint: 5])
        #expect(model.values.payload.purchases.map(\.purchasePrice) == [Decimal(2), Decimal(4)])
        #expect(TCGCardsValidator.issues(for: model.values).isEmpty)
        #expect(model.hasUnsavedChanges)
    }

    @Test
    func `Market refresh preserves a manually edited price`() {
        let model = TCGCardFormScreenModel(mode: .add, initialValues: validValues)
        model.values.batches[0].priceText = "1.234567"
        model.values.batches[0].priceWasEdited = true
        model.applyMarketDefault(PreviewTCGPricingClient.samplePricedCards[0])
        #expect(model.values.batches[0].price == Decimal(string: "1.234567"))
    }

    @Test
    func `Changing the selected card clears automatic prices but preserves manual costs`() {
        let model = TCGCardFormScreenModel(mode: .add, initialValues: validValues)
        model.applyMarketDefault(PreviewTCGPricingClient.samplePricedCards[0])
        model.addBatch(condition: .played)
        model.values.batches[1].priceText = "3.50"
        model.values.batches[1].priceWasEdited = true
        model.values.name = "Different card"
        #expect(model.values.batches[0].priceText.isEmpty)
        #expect(model.values.batches[1].price == Decimal(string: "3.50"))
        #expect(model.values.defaultMarketPrice == nil)
    }

    @Test
    func `Invalid purchase text is validated and requires discard confirmation`() {
        let model = TCGCardFormScreenModel(mode: .add, initialValues: validValues)
        model.values.batches[0].priceText = "-1"
        #expect(TCGCardsValidator.issues(for: model.values).map(\.field) == [.purchases])
        #expect(model.hasUnsavedChanges)
        #expect(!model.requestDismissal())
    }

    @Test
    func `A missing average does not use the lowest price`() {
        let card = PricedCard(
            id: "low-only",
            game: .pokemon,
            name: "Pikachu",
            cardNumber: "58",
            market: MarketPrice(currency: .usd, low: 10),
            pricedOn: .now,
            fetchedAt: .now
        )
        let model = TCGCardFormScreenModel(mode: .add, initialValues: .init(pricedCard: card))
        model.addBatch(condition: .mint)
        #expect(model.values.batches.first?.price == nil)
    }

    @Test
    func `A pricing response for an obsolete card cannot prefill the edited card`() async throws {
        let transport = PendingCardSubmissionTransport()
        let client = try makeClient(transport: transport)
        let model = TCGCardFormScreenModel(mode: .add, initialValues: validValues)
        let refresh = Task { await model.refreshPurchaseDefault(using: TCGCards(client: client)) }
        await transport.waitForRequest()
        model.values.name = "Different card"
        await transport.completePricing()
        await refresh.value
        #expect(model.values.defaultMarketPrice == nil)
        #expect(model.values.batches[0].priceText.isEmpty)
        #expect(model.values.name == "Different card")
    }

    private func makeClient(transport: any ClientTransport) throws -> TCGClient {
        let credentials = Credentials(
            authToken: "auth-token",
            authTokenExpiryDate: .distantFuture,
            sessionToken: "session-token",
            sessionUpdateAge: 1800,
            lastSessionUpdate: .now
        )
        return TCGClient.default(
            transport: transport,
            credentialsKeychainKey: "card-form-tests",
            credentialsStore: InMemoryCredentialsStore(seed: try JSONEncoder().encode(credentials))
        )
    }

    enum ChangedTextField: CaseIterable, Sendable {
        case name, setName, cardNumber, notes

        var keyPath: WritableKeyPath<CardFormValues, String> {
            switch self {
            case .name: \CardFormValues.name
            case .setName: \CardFormValues.setName
            case .cardNumber: \CardFormValues.cardNumber
            case .notes: \CardFormValues.notes
            }
        }
    }
}

private actor PurchaseSaveTransport: ClientTransport {
    private(set) var requestBody: Data?

    func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws -> (
        HTTPResponse, HTTPBody?
    ) {
        if let body { requestBody = try await Data(collecting: body, upTo: 1_000_000) }
        let response = """
            {
              "id":"saved-card","game":"one_piece","name":"Monkey D. Luffy",
              "set_name":"Romance Dawn","card_number":"OP01-003","notes":null,
              "created_at":"2026-10-16T10:00:00.000Z","updated_at":"2026-10-16T10:00:00.000Z",
              "purchases":[{"id":"saved-purchase","condition":"near_mint","quantity":2,
                "purchase_price":"5.263158","currency":"EUR","automatic_price_date":null}],
              "purchase_price_change_percent":null,"price":{"card_id":"saved-card","status":"no_price"}
            }
            """
        return (HTTPResponse(status: .created, headerFields: [.contentType: "application/json"]), HTTPBody(response))
    }
}

private actor PendingCardSubmissionTransport: ClientTransport {
    private var hasStarted = false
    private var waitingForRequest: CheckedContinuation<Void, Never>?
    private var response: CheckedContinuation<(HTTPResponse, HTTPBody?), Never>?

    func send(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        await withCheckedContinuation { continuation in
            response = continuation
            hasStarted = true
            waitingForRequest?.resume()
            waitingForRequest = nil
        }
    }

    func waitForRequest() async {
        guard !hasStarted else { return }
        await withCheckedContinuation { waitingForRequest = $0 }
    }

    func completePricing() {
        guard let response else { preconditionFailure("A pricing request must be pending.") }
        self.response = nil
        let body = """
            {"matches":[{"id":"priced-card","game":"one_piece","name":"Monkey D. Luffy","card_number":"OP01-003",
            "market":{"condition":"near_mint","currency":"USD","market":5},
            "priced_on":"2026-10-08T00:00:00.000Z","fetched_at":"2026-10-08T10:00:00.000Z"}]}
            """
        response.resume(
            returning: (HTTPResponse(status: .ok, headerFields: [.contentType: "application/json"]), HTTPBody(body))
        )
    }

    func failRequest() {
        guard let response else { preconditionFailure("A submission must be pending.") }
        self.response = nil
        response.resume(returning: (HTTPResponse(status: .serviceUnavailable), nil))
    }
}
