//
//  TCGCardsFeatureTests.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/20/26.
//

import Foundation
import Testing

@testable import TCGCards
@testable import TCGClient

@Suite("TCGCards Feature Tests")
@MainActor
struct TCGCardsFeatureTests {
    @Test
    func `Should load the sample cards from the preview client`() async throws {
        let cards = TCGCards(client: .preview(cardsOutcome: .success(cards: PreviewTCGCardsClient.sampleCards)))

        let result = await cards.loadCards()

        try result.get()
        #expect(cards.cards == PreviewTCGCardsClient.sampleCards)
        #expect(cards.isLoading == false)
    }

    @Test
    func `Should load an empty collection for the empty outcome`() async throws {
        let cards = TCGCards(client: .preview(cardsOutcome: .empty))

        let result = await cards.loadCards()

        try result.get()
        #expect(cards.cards.isEmpty)
    }

    @Test
    func `Should prepend added cards to the collection`() async throws {
        let cards = TCGCards(client: .preview(cardsOutcome: .success(cards: PreviewTCGCardsClient.sampleCards)))
        _ = await cards.loadCards()

        let result = await cards.addCard(makeFormValues(name: "Roronoa Zoro"))

        try result.get()
        #expect(cards.cards.count == PreviewTCGCardsClient.sampleCards.count + 1)
        #expect(cards.cards.first?.name == "Roronoa Zoro")
    }

    @Test
    func `Should replace an updated card in the collection`() async throws {
        let cards = TCGCards(client: .preview(cardsOutcome: .success(cards: PreviewTCGCardsClient.sampleCards)))
        _ = await cards.loadCards()
        let cardToUpdate = try #require(cards.cards.first)

        let result = await cards.updateCard(id: cardToUpdate.id, values: makeFormValues(name: "Nami"))

        try result.get()
        #expect(cards.cards.count == PreviewTCGCardsClient.sampleCards.count)
        #expect(cards.cards.first?.id == cardToUpdate.id)
        #expect(cards.cards.first?.name == "Nami")
    }

    @Test
    func `Should remove a deleted card from the collection`() async throws {
        let cards = TCGCards(client: .preview(cardsOutcome: .success(cards: PreviewTCGCardsClient.sampleCards)))
        _ = await cards.loadCards()
        let cardToDelete = try #require(cards.cards.first)

        let result = await cards.deleteCard(id: cardToDelete.id)

        try result.get()
        #expect(cards.cards.count == PreviewTCGCardsClient.sampleCards.count - 1)
        #expect(!cards.cards.contains(where: { card in card.id == cardToDelete.id }))
    }

    @Test
    func `Should fail loading with a server unavailable error`() async throws {
        let cards = TCGCards(client: .preview(cardsOutcome: .serverUnavailable))

        let result = await cards.loadCards()

        try #require(throws: TCGCardsOperationError.serverUnavailable) {
            try result.get()
        }
        #expect(cards.isLoading == false)
    }

    @Test
    func `Should fail updating with a not found error`() async throws {
        let cards = TCGCards(client: .preview(cardsOutcome: .notFound))

        let result = await cards.updateCard(id: "preview-card-1", values: makeFormValues(name: "Nami"))

        try #require(throws: TCGCardsOperationError.notFound) {
            try result.get()
        }
    }

    @Test
    func `Should map server validation issues to card validation issues`() async throws {
        let issue = TCGClientValidationIssue(code: "too_small", path: ["set_name"], message: "Set name is required")
        let cards = TCGCards(client: .preview(cardsOutcome: .validationErrors([issue])))

        let result = await cards.addCard(makeFormValues(name: "Roronoa Zoro"))

        try #require(
            throws: TCGCardsOperationError.validation(
                [TCGCardsValidationIssue(field: .setName, message: "Set name is required")]
            )
        ) {
            try result.get()
        }
    }

    private func makeFormValues(name: String) -> CardFormValues {
        CardFormValues(
            game: .onePiece,
            name: name,
            setName: "Romance Dawn",
            cardNumber: "OP01-025",
            notes: "",
            quantities: [.nearMint: 1]
        )
    }
}
