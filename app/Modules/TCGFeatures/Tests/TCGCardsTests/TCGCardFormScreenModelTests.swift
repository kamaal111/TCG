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
    func `Uses matched and estimated condition values for new purchases and clears provenance after an edit`() {
        let card = PricedCard(
            id: "condition-pricing",
            printingKey: nil,
            isWishlisted: nil,
            game: .pokemon,
            name: "Pikachu",
            cardNumber: "58",
            setName: nil,
            rarity: nil,
            illustrator: nil,
            englishSearchAlias: nil,
            variantName: nil,
            imageURL: nil,
            headline: nil,
            market: nil,
            conditionPrices: nil,
            conditionValues: [
                ConditionValue(
                    condition: .excellent,
                    currency: .usd,
                    amount: 20,
                    basis: .market,
                    conversionUnavailable: nil
                ),
                ConditionValue(
                    condition: .good,
                    currency: .usd,
                    amount: 16,
                    basis: .interpolated,
                    conversionUnavailable: nil
                ),
            ],
            display: nil,
            pricedOn: Date(timeIntervalSince1970: 0),
            fetchedAt: Date(timeIntervalSince1970: 0)
        )
        var values = CardFormValues(pricedCard: card)
        values.batches = [values.newBatch(condition: .excellent), values.newBatch(condition: .good)]
        #expect(values.payload.purchases.map(\.purchasePrice) == [20, 16])
        #expect(values.payload.purchases.map(\.automaticPriceDate) == ["1970-01-01", "1970-01-01"])

        values.batches[1].priceText = "13"
        values.batches[1].priceWasEdited = true
        #expect(values.payload.purchases.map(\.purchasePrice) == [20, 13])
        #expect(values.payload.purchases.map(\.automaticPriceDate) == ["1970-01-01", nil])
    }

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
        let model = TCGCardFormScreenModel(mode: .add(CardsTestIDs.addPrinting), initialValues: validValues)
        model.values.defaultMarketPrice = 284
        model.values.defaultMarketCurrency = .usd
        model.configureCurrency(preferred: .usd, rates: currencySelectionRates)
        return model
    }

    @Test func `A full binder keeps the draft and displays the API message on the collection field`() async throws {
        let message = "This binder has no room for these copies. Choose another collection."
        let transport = CSVImportTransport(
            status: .badRequest,
            response: """
                {"message":"Invalid validation","code":"INVALID_PAYLOAD","context":{"validations":[
                    {"code":"binder_full","path":["collection_id"],"message":"\(message)"}
                ]}}
                """,
            fails: false,
            catalogPages: []
        )
        let model = TCGCardFormScreenModel(mode: .add(CardsTestIDs.addPrinting), initialValues: validValues)
        let original = model.values
        let cards = TCGCards(client: try makeClient(transport: transport))
        #expect(!(await model.submit(using: cards)))
        #expect(model.values == original)
        #expect(model.fieldErrors[.collection] == message)
        #expect(!model.isSubmitting)
    }

    @Test func `Failed collection creation preserves the card draft and presents no browser error`() async throws {
        let transport = CSVImportTransport(
            status: .serviceUnavailable,
            response: """
                {"message":"Unavailable","code":"UNAVAILABLE"}
                """,
            fails: false,
            catalogPages: []
        )
        let collections = TCGCollections(client: try makeClient(transport: transport), defaults: nil)
        let model = TCGCardFormScreenModel(
            mode: .add(PreviewTCGPricingClient.samplePricedCards[0]),
            initialValues: nil
        )
        let original = model.values
        await #expect(throws: CollectionsError.unavailable) {
            try await model.createCollection(name: "Favorites", using: collections).get()
        }
        #expect(model.values == original)
        #expect(collections.collections.isEmpty)
        #expect(collections.error == nil)
        #expect(!collections.isWorking)
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
        let model = TCGCardFormScreenModel(mode: .add(CardsTestIDs.addPrinting), initialValues: validValues)
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
        let model = TCGCardFormScreenModel(mode: .add(CardsTestIDs.addPrinting), initialValues: validValues)
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
        let model = TCGCardFormScreenModel(mode: .add(CardsTestIDs.addPrinting), initialValues: validValues)
        model.values.defaultMarketPrice = 10
        model.values.defaultMarketCurrency = .usd
        model.configureCurrency(
            preferred: .eur,
            rates: ExchangeRates(date: "2026-10-16", rates: ["EUR": 1, "USD": 1.9])
        )
        let transport = PurchaseSaveTransport()
        let saved = try await makeClient(transport: transport).cards
            .create(with: .init(pricedCardID: CardsTestIDs.addPrintingID, ownership: model.values.payload))
            .get()
        let body = try #require(await transport.requestBody)
        let sent = try JSONDecoder().decode(Components.Schemas.CreateCard.self, from: body)
        #expect(sent.pricedCardId == CardsTestIDs.addPrintingID.uuidString.lowercased())
        let purchase = try #require(sent.purchases.first)
        #expect(purchase.purchasePrice == "5.263158")
        #expect(purchase.currency?.rawValue == "EUR")
        #expect(saved.card.purchases.first?.purchasePrice == Decimal(string: "5.263158"))
        #expect(TCGCardsValidator.issues(for: model.values).isEmpty)
    }

    @Test
    func `Market defaults return a converted batch without changing the original`() {
        let model = TCGCardFormScreenModel(mode: .add(CardsTestIDs.addPrinting), initialValues: nil)
        model.configureCurrency(
            preferred: .eur,
            rates: ExchangeRates(date: "2026-10-16", rates: ["EUR": 1, "USD": 1.25])
        )
        model.values.defaultMarketPrice = 12.5
        model.values.defaultMarketCurrency = .usd
        let original = PurchaseBatchFormValue(condition: .nearMint, quantity: 2, priceText: "", currency: .usd)
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
        let model = TCGCardFormScreenModel(mode: .add(CardsTestIDs.addPrinting), initialValues: nil)
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
        let model = TCGCardFormScreenModel(mode: .add(card), initialValues: nil)
        #expect(model.values.game == card.game)
        #expect(model.values.name == card.name)
        #expect(model.values.setName == card.setName)
        #expect(model.values.cardNumber == card.cardNumber)
        #expect(model.values.quantities.isEmpty)
        #expect(model.values.notes.isEmpty)
    }

    @Test(arguments: PreviewTCGPricingClient.samplePricedCards)
    func `Searched card details are the dismissal baseline`(card: PricedCard) {
        let model = TCGCardFormScreenModel(mode: .add(card), initialValues: nil)
        #expect(!model.hasUnsavedChanges)
        #expect(model.requestDismissal())
        model.values.notes = "Edited note"
        #expect(!model.requestDismissal())
        #expect(model.isShowingDiscardConfirmation)
        model.keepEditing()
        model.values.notes = ""
        #expect(!model.hasUnsavedChanges)
        #expect(model.requestDismissal())
    }

    @Test(arguments: PreviewTCGPricingClient.samplePricedCards)
    func `Searched cards require a quantity before saving`(card: PricedCard) async {
        let model = TCGCardFormScreenModel(mode: .add(card), initialValues: nil)
        let collection = TCGCards(client: .preview(cardsOutcome: .empty))
        #expect(!(await model.submit(using: collection)))
        #expect(Set(model.fieldErrors.keys) == [.quantities])
        #expect(collection.cards.isEmpty)
    }

    @Test(arguments: PreviewTCGPricingClient.samplePricedCards)
    func `Prefilled add saves the selected printing, quantities and notes`(card: PricedCard) async throws {
        let model = TCGCardFormScreenModel(mode: .add(card), initialValues: nil)
        let collection = TCGCards(client: .preview(cardsOutcome: .empty))
        model.values.quantities = [.nearMint: 2, .played: 1]
        model.values.notes = "  My notes  "
        #expect(await model.submit(using: collection))
        let saved = try #require(collection.cards.first?.card)
        #expect(saved.game == card.game)
        #expect(saved.name == card.name)
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
            mode: .add(PreviewTCGPricingClient.samplePricedCards[0]),
            initialValues: nil
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
        let add = TCGCardFormScreenModel(mode: .add(CardsTestIDs.addPrinting), initialValues: nil)
        let edit = TCGCardFormScreenModel(mode: .edit(PreviewTCGCardsClient.sampleCards[0]), initialValues: nil)
        #expect(add.requestDismissal())
        #expect(edit.requestDismissal())
        #expect(!add.isShowingDiscardConfirmation)
        #expect(!edit.isShowingDiscardConfirmation)
    }

    @Test
    func `Changed notes require discard confirmation`() {
        let model = TCGCardFormScreenModel(mode: .add(CardsTestIDs.addPrinting), initialValues: nil)
        model.values.notes = "Draft"
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
        let model = TCGCardFormScreenModel(mode: .add(CardsTestIDs.addPrinting), initialValues: nil)
        model.values.quantities[.nearMint] = 1
        #expect(model.hasUnsavedChanges)
        model.values.quantities[.nearMint] = 0
        #expect(!model.hasUnsavedChanges)
        #expect(model.requestDismissal())
    }

    @Test
    func `Keeping edits preserves the draft and validation errors`() async {
        let model = TCGCardFormScreenModel(mode: .add(CardsTestIDs.addPrinting), initialValues: nil)
        model.values.notes = "Draft"
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
        let model = TCGCardFormScreenModel(mode: .add(CardsTestIDs.addPrinting), initialValues: nil)
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
    func `Missing purchases are validated`() async {
        let model = TCGCardFormScreenModel(mode: .add(CardsTestIDs.addPrinting), initialValues: nil)
        let submitted = await model.submit(using: TCGCards(client: .preview(cardsOutcome: .empty)))
        #expect(!submitted)
        #expect(model.fieldErrors[.quantities] != nil)
        #expect(!model.isSubmitting)
    }

    @Test
    func `Valid add submits successfully`() async {
        let model = TCGCardFormScreenModel(mode: .add(CardsTestIDs.addPrinting), initialValues: nil)
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
    func `Server validation maps a printing error and unavailable sets toast`() async {
        let issue = TCGClientValidationIssue(code: "too_small", path: ["priced_card_id"], message: "Required")
        let validationModel = TCGCardFormScreenModel(mode: .add(CardsTestIDs.addPrinting), initialValues: nil)
        validationModel.values = validValues
        _ = await validationModel.submit(
            using: TCGCards(client: .preview(cardsOutcome: .validationErrors([issue])))
        )
        #expect(validationModel.fieldErrors[.printing] == "Required")

        let unavailableModel = TCGCardFormScreenModel(mode: .add(CardsTestIDs.addPrinting), initialValues: nil)
        unavailableModel.values = validValues
        _ = await unavailableModel.submit(using: TCGCards(client: .preview(cardsOutcome: .serverUnavailable)))
        #expect(unavailableModel.toast != nil)
        #expect(!unavailableModel.isSubmitting)
    }

    @Test
    func `New batches prefill the average instead of the lowest price`() throws {
        let card = PreviewTCGPricingClient.samplePricedCards[0]
        let model = TCGCardFormScreenModel(mode: .add(card), initialValues: nil)
        model.addBatch(condition: .played)
        let batch = try #require(model.values.batches.first)
        let average = try #require(card.market?.market)
        #expect(batch.price == Decimal(string: String(format: "%.6f", average)))
        #expect(batch.currency == card.market?.currency)
        #expect(model.values.payload.purchases.first?.quantity == 1)
    }

    @Test
    func `Multiple purchases in one condition retain individual costs and aggregate quantities`() {
        let model = TCGCardFormScreenModel(mode: .add(CardsTestIDs.addPrinting), initialValues: validValues)
        model.values.batches = [
            .init(condition: .nearMint, quantity: 2, priceText: "2", currency: .fallback),
            .init(condition: .nearMint, quantity: 3, priceText: "4", currency: .fallback),
        ]
        #expect(model.values.quantities == [.nearMint: 5])
        #expect(model.values.payload.purchases.map(\.purchasePrice) == [Decimal(2), Decimal(4)])
        #expect(TCGCardsValidator.issues(for: model.values).isEmpty)
        #expect(model.hasUnsavedChanges)
    }

    @Test
    func `Market refresh preserves a manually edited price`() {
        let model = TCGCardFormScreenModel(mode: .add(CardsTestIDs.addPrinting), initialValues: validValues)
        model.values.batches[0].priceText = "1.234567"
        model.values.batches[0].priceWasEdited = true
        model.applyMarketDefault(PreviewTCGPricingClient.samplePricedCards[0])
        #expect(model.values.batches[0].price == Decimal(string: "1.234567"))
    }

    @Test
    func `Invalid purchase text is validated and requires discard confirmation`() {
        let model = TCGCardFormScreenModel(mode: .add(CardsTestIDs.addPrinting), initialValues: validValues)
        model.values.batches[0].priceText = "-1"
        #expect(TCGCardsValidator.issues(for: model.values).map(\.field) == [.purchases])
        #expect(model.hasUnsavedChanges)
        #expect(!model.requestDismissal())
    }

    @Test
    func `A missing average does not use the lowest price`() {
        let card = PricedCard(
            id: "low-only",
            printingKey: nil,
            isWishlisted: nil,
            game: .pokemon,
            name: "Pikachu",
            cardNumber: "58",
            setName: nil,
            rarity: nil,
            illustrator: nil,
            englishSearchAlias: nil,
            variantName: nil,
            imageURL: nil,
            headline: nil,
            market: MarketPrice(
                condition: .nearMint,
                currency: .usd,
                low: 10,
                market: nil,
                trend7d: nil,
                trend30d: nil
            ),
            conditionPrices: nil,
            conditionValues: nil,
            display: nil,
            pricedOn: .now,
            fetchedAt: .now
        )
        let model = TCGCardFormScreenModel(mode: .add(card), initialValues: nil)
        model.addBatch(condition: .mint)
        #expect(model.values.batches.first?.price == nil)
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

}

private actor PurchaseSaveTransport: ClientTransport {
    private(set) var requestBody: Data?

    func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws -> (
        HTTPResponse, HTTPBody?
    ) {
        if let body { requestBody = try await Data(collecting: body, upTo: 1_000_000) }
        let response = """
            {
              "id":"00000000-0000-4000-8000-000000000072","game":"one_piece","name":"Monkey D. Luffy",
              "set_name":"Romance Dawn","card_number":"OP01-003","notes":null,
              "created_at":"2026-10-16T10:00:00.000Z","updated_at":"2026-10-16T10:00:00.000Z",
              "purchases":[{"id":"00000000-0000-4000-8000-000000000073","condition":"near_mint","quantity":2,
                "purchase_price":"5.263158","currency":"EUR","automatic_price_date":null}],
              "purchase_price_change_percent":null,"price":{"card_id":"00000000-0000-4000-8000-000000000072","status":"no_price"}
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

    func failRequest() {
        guard let response else { preconditionFailure("A submission must be pending.") }
        self.response = nil
        response.resume(returning: (HTTPResponse(status: .serviceUnavailable), nil))
    }
}
