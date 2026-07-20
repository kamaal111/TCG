//
//  TCGCardFormScreenModelTests.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/20/26.
//

import Foundation
import Testing

@testable import TCGCards
@testable import TCGClient

@Suite("TCGCardFormScreenModel Tests")
@MainActor
struct TCGCardFormScreenModelTests {
    @Test
    func `Should report an error for an empty name`() async {
        let model = makeFilledAddModel(name: "")

        let submitted = await model.submit(using: makeCards())

        #expect(submitted == false)
        #expect(model.fieldErrors[.name] == "Enter the card name.")
    }

    @Test
    func `Should report an error for an empty set name`() async {
        let model = makeFilledAddModel(setName: "")

        let submitted = await model.submit(using: makeCards())

        #expect(submitted == false)
        #expect(model.fieldErrors[.setName] == "Enter the set name.")
    }

    @Test
    func `Should report an error for an empty card number`() async {
        let model = makeFilledAddModel(cardNumber: "")

        let submitted = await model.submit(using: makeCards())

        #expect(submitted == false)
        #expect(model.fieldErrors[.cardNumber] == "Enter the card number.")
    }

    @Test
    func `Should report an error when every quantity is zero`() async {
        let model = makeFilledAddModel(quantities: [:])

        let submitted = await model.submit(using: makeCards())

        #expect(submitted == false)
        #expect(model.fieldErrors[.quantities] == "Add at least one copy in any condition.")
    }

    @Test
    func `Should submit a valid add form successfully`() async {
        let cards = makeCards(outcome: .empty)
        let model = makeFilledAddModel()

        let submitted = await model.submit(using: cards)

        #expect(submitted == true)
        #expect(model.fieldErrors.isEmpty)
        #expect(model.toast == nil)
        #expect(cards.cards.count == 1)
    }

    @Test
    func `Should prefill the form when editing a card`() {
        let card = Card(
            id: "card-1",
            game: .pokemon,
            name: "Pikachu",
            setName: "Base Set",
            cardNumber: "58/102",
            notes: "First edition",
            quantities: [CardConditionQuantity(condition: .mint, quantity: 3)],
            createdAt: Date(timeIntervalSince1970: 1_750_000_000),
            updatedAt: Date(timeIntervalSince1970: 1_750_000_000)
        )

        let model = TCGCardFormScreenModel(mode: .edit(card))

        #expect(model.game == .pokemon)
        #expect(model.name == "Pikachu")
        #expect(model.setName == "Base Set")
        #expect(model.cardNumber == "58/102")
        #expect(model.notes == "First edition")
        #expect(model.quantity(for: .mint) == 3)
        #expect(model.quantity(for: .played) == 0)
        #expect(model.title == "Edit Card")
    }

    @Test
    func `Should map a server validation issue to the set name field`() async {
        let issue = TCGClientValidationIssue(code: "too_small", path: ["set_name"], message: "Set name is required")
        let cards = makeCards(outcome: .validationErrors([issue]))
        let model = makeFilledAddModel()

        let submitted = await model.submit(using: cards)

        #expect(submitted == false)
        #expect(model.fieldErrors[.setName] == "Set name is required")
    }

    @Test
    func `Should show a toast when the server is unavailable`() async {
        let cards = makeCards(outcome: .serverUnavailable)
        let model = makeFilledAddModel()

        let submitted = await model.submit(using: cards)

        #expect(submitted == false)
        #expect(model.toast?.title == "Card could not be saved")
        #expect(model.toast?.message == "The server is unavailable. Please try again.")
    }

    @Test
    func `Should reset the submitting state after completion`() async {
        let cards = makeCards(outcome: .serverUnavailable)
        let model = makeFilledAddModel()

        _ = await model.submit(using: cards)

        #expect(model.isSubmitting == false)
    }

    @Test
    func `Should revalidate edited fields after a failed submit`() async {
        let model = makeFilledAddModel(name: "")
        _ = await model.submit(using: makeCards())

        model.name = "Monkey D. Luffy"

        #expect(model.fieldErrors[.name] == nil)
    }

    private func makeCards(outcome: PreviewTCGCardsOutcome = .empty) -> TCGCards {
        TCGCards(client: .preview(cardsOutcome: outcome))
    }

    private func makeFilledAddModel(
        name: String = "Monkey D. Luffy",
        setName: String = "Romance Dawn",
        cardNumber: String = "OP01-003",
        quantities: [CardCondition: Int] = [.nearMint: 2]
    ) -> TCGCardFormScreenModel {
        let model = TCGCardFormScreenModel(mode: .add)
        model.name = name
        model.setName = setName
        model.cardNumber = cardNumber
        for (condition, quantity) in quantities {
            model.setQuantity(quantity, for: condition)
        }

        return model
    }
}
