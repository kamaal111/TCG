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
    @Test
    func `Empty fields and quantities are validated`() async {
        let model = TCGCardFormScreenModel(mode: .add)
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
        let model = TCGCardFormScreenModel(mode: .add)
        model.values = validValues
        #expect(await model.submit(using: TCGCards(client: .preview(cardsOutcome: .empty))))
        #expect(!model.isSubmitting)
    }

    @Test
    func `Edit prefills every card value`() {
        let card = PreviewTCGCardsClient.sampleCards[0]
        let model = TCGCardFormScreenModel(mode: .edit(card))
        #expect(model.values.name == card.name)
        #expect(model.values.quantities[.nearMint] == 2)
    }

    @Test
    func `Server validation maps set name and unavailable sets toast`() async {
        let issue = TCGClientValidationIssue(code: "too_small", path: ["set_name"], message: "Required")
        let validationModel = TCGCardFormScreenModel(mode: .add)
        validationModel.values = validValues
        _ = await validationModel.submit(
            using: TCGCards(client: .preview(cardsOutcome: .validationErrors([issue])))
        )
        #expect(validationModel.fieldErrors[.setName] == "Required")

        let unavailableModel = TCGCardFormScreenModel(mode: .add)
        unavailableModel.values = validValues
        _ = await unavailableModel.submit(using: TCGCards(client: .preview(cardsOutcome: .serverUnavailable)))
        #expect(unavailableModel.toast != nil)
        #expect(!unavailableModel.isSubmitting)
    }
}
