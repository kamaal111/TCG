//
//  TCGCardFormScreenModelTests.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/20/26.
//

import Testing

@testable import TCGCards
@testable import TCGClient

@Suite("TCGCard Form Screen Model Tests")
@MainActor
struct TCGCardFormScreenModelTests {
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
            id: "missing-set", game: .pokemon, name: "Pikachu", cardNumber: "58/102",
            pricedOn: .distantPast, fetchedAt: .distantPast)
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
                ]))
    }

    @Test
    func `Prefilled add retains values after server failure`() async {
        let model = TCGCardFormScreenModel(
            mode: .add,
            initialValues: .init(pricedCard: PreviewTCGPricingClient.samplePricedCards[0]))
        model.values.quantities = [.nearMint: 1]
        model.values.notes = "Keep this draft"
        let values = model.values
        #expect(!(await model.submit(using: TCGCards(client: .preview(cardsOutcome: .serverUnavailable)))))
        #expect(model.values == values)
        #expect(model.toast != nil)
        #expect(!model.isSubmitting)
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
}
