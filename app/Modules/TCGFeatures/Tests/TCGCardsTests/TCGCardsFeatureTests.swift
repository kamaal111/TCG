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
    func `Load populates preview cards`() async throws {
        let feature = makeFeature(.success(cards: PreviewTCGCardsClient.sampleCards))
        try await feature.loadCards().get()
        #expect(feature.cards == PreviewTCGCardsClient.sampleCards)
    }

    @Test
    func `Empty load clears cards`() async throws {
        let feature = makeFeature(.empty)
        try await feature.loadCards().get()
        #expect(feature.cards.isEmpty)
    }

    @Test
    func `Add update and delete mutate the collection`() async throws {
        let feature = makeFeature(.empty)
        try await feature.addCard(validValues).get()
        let card = try #require(feature.cards.first)
        var updated = validValues
        updated.name = "Updated"
        try await feature.updateCard(id: card.id, values: updated).get()
        #expect(feature.cards.first?.name == "Updated")
        try await feature.deleteCard(id: card.id).get()
        #expect(feature.cards.isEmpty)
    }

    @Test
    func `Server unavailable load fails`() async {
        let feature = makeFeature(.serverUnavailable)
        await #expect(throws: TCGCardsOperationError.serverUnavailable) { try await feature.loadCards().get() }
    }

    @Test
    func `Owned pricing is indexed by card identifier`() async throws {
        let feature = makeFeature(.success(cards: PreviewTCGCardsClient.sampleCards))

        try await feature.loadOwnedPrices().get()

        #expect(
            feature.prices
                == Dictionary(
                    uniqueKeysWithValues: PreviewTCGPricingClient.sampleOwnedPrices.map { ($0.cardId, $0) }
                ))
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
