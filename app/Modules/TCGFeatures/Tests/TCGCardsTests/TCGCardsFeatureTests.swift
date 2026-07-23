//
//  TCGCardsFeatureTests.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/20/26.
//

import Testing

@testable import TCGCards
@testable import TCGClient

@Suite("TCGCards Feature Tests")
@MainActor
struct TCGCardsFeatureTests {
    @Test
    func `Load populates cards with prices`() async throws {
        let feature = makeFeature(.success(cards: PreviewTCGCardsClient.sampleCards))
        try await feature.load(game: nil).get()
        #expect(feature.cards.map(\.card) == PreviewTCGCardsClient.sampleCards)
        #expect(feature.cards.map(\.price) == PreviewTCGCardsClient.sampleCards.map(PreviewTCGCardsClient.price))
    }

    @Test
    func `Empty load clears cards`() async throws {
        let feature = makeFeature(.empty)
        try await feature.load(game: nil).get()
        #expect(feature.cards.isEmpty)
    }

    @Test
    func `Load requests cards and prices for the selected game`() async throws {
        let feature = makeFeature(.success(cards: PreviewTCGCardsClient.sampleCards))

        try await feature.load(game: .pokemon).get()

        #expect(feature.cards.map(\.card.id) == ["preview-card-2"])
        #expect(feature.cards.map(\.price.cardId) == ["preview-card-2"])
    }

    @Test
    func `Add update and delete mutate the collection`() async throws {
        let feature = makeFeature(.empty)
        try await feature.addCard(validValues).get()
        let cardWithPrice = try #require(feature.cards.first)
        var updated = validValues
        updated.name = "Updated"
        try await feature.updateCard(id: cardWithPrice.card.id, values: updated).get()
        #expect(feature.cards.first?.card.name == "Updated")
        try await feature.deleteCard(id: cardWithPrice.card.id).get()
        #expect(feature.cards.isEmpty)
    }

    @Test
    func `Adding a card fetches and merges only that card's price`() async throws {
        let feature = makeFeature(.empty)

        try await feature.addCard(validValues).get()
        let card = try #require(feature.cards.first)

        #expect(feature.cards.map(\.card.id) == [card.card.id])
        #expect(card.price == PreviewTCGCardsClient.price(for: card.card))
    }

    @Test
    func `Updating a card merges its refreshed price without clearing other prices`() async throws {
        let feature = makeFeature(.success(cards: PreviewTCGCardsClient.sampleCards))
        try await feature.load(game: nil).get()
        let otherCardId = try #require(PreviewTCGCardsClient.sampleCards.first { $0.id != "preview-card-1" }?.id)
        let priceBeforeUpdate = feature.cards.first { $0.card.id == otherCardId }?.price

        var updated = validValues
        updated.name = "Updated"
        try await feature.updateCard(id: "preview-card-1", values: updated).get()

        #expect(feature.cards.first { $0.card.id == "preview-card-1" }?.price != nil)
        #expect(feature.cards.first { $0.card.id == otherCardId }?.price == priceBeforeUpdate)
    }

    @Test
    func `Load returns a cards failure`() async {
        let feature = makeFeature(.serverUnavailable)
        await #expect(throws: TCGCardsOperationError.serverUnavailable) { try await feature.load(game: nil).get() }
    }

    @Test
    func `Pricing stays attached to its card`() async throws {
        let feature = makeFeature(.success(cards: PreviewTCGCardsClient.sampleCards))

        try await feature.load(game: nil).get()

        #expect(feature.cards.allSatisfy { $0.card.id == $0.price.cardId })
    }

    @Test
    func `Missing update fails`() async {
        let feature = makeFeature(.notFound)
        await #expect(throws: TCGCardsOperationError.notFound) {
            try await feature.updateCard(id: "preview-card-1", values: validValues).get()
        }
    }

    private func makeFeature(_ outcome: PreviewTCGCardsOutcome) -> TCGCards {
        TCGCards(client: .preview(cardsOutcome: outcome))
    }
}

var validValues: CardFormValues {
    CardFormValues(
        game: .onePiece,
        name: "Monkey D. Luffy",
        setName: "Romance Dawn",
        cardNumber: "OP01-003",
        notes: "",
        quantities: [.nearMint: 2]
    )
}
