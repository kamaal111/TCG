//
//  TCGCardsListScreenSnapshotTests.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/20/26.
//

import SwiftUI
import TCGDesignSystem
import TCGSnapshotTesting
import Testing

@testable import TCGCards
@testable import TCGClient

@Suite("TCGCards List Screen Snapshot Tests")
@MainActor
struct TCGCardsListScreenSnapshotTests {
    @Test
    func `Renders a populated collection`() async throws {
        let feature = TCGCards(client: .preview(cardsOutcome: .success(cards: PreviewTCGCardsClient.sampleCards)))
        try await feature.load(game: .onePiece).get()
        await assertScreenSnapshot(testName: #function) { makeScreen(feature: feature) }
    }

    @Test
    func `Renders an empty collection`() async throws {
        let feature = TCGCards(client: .preview(cardsOutcome: .empty))
        try await feature.load(game: nil).get()
        await assertScreenSnapshot(testName: #function) { makeScreen(feature: feature) }
    }

    @Test
    func `Renders a One Piece filter`() async throws {
        let feature = TCGCards(client: .preview(cardsOutcome: .success(cards: PreviewTCGCardsClient.sampleCards)))
        try await feature.load(game: nil).get()
        let model = TCGCardsListScreenModel()
        model.gameFilter = .onePiece
        await assertScreenSnapshot(testName: #function) { makeScreen(feature: feature, model: model) }
    }

    @Test
    func `Renders a collection with some unavailable prices`() async throws {
        let feature = makeUnavailableFeature(allUnavailable: false)
        try await feature.load(game: nil).get()
        #expect(feature.cards.map(\.price.status) == [.unavailable, .priced])
        await assertScreenSnapshot(testName: #function) { makeScreen(feature: feature) }
    }

    @Test
    func `Renders a collection with all prices unavailable`() async throws {
        let feature = makeUnavailableFeature(allUnavailable: true)
        try await feature.load(game: nil).get()
        #expect(feature.cards.allSatisfy { $0.price.status == .unavailable })
        await assertScreenSnapshot(testName: #function) { makeScreen(feature: feature) }
    }

    private func makeUnavailableFeature(allUnavailable: Bool) -> TCGCards {
        let cards = PreviewTCGCardsClient.sampleCards.enumerated().map { index, card in
            CardWithPrice(
                card: card,
                price: allUnavailable || index == 0
                    ? OwnedCardPrice(cardId: card.id, status: .unavailable)
                    : PreviewTCGCardsClient.price(for: card)
            )
        }
        return TCGCards(client: .preview(cardsOutcome: .successWithPrices(cards)))
    }

    private func makeScreen(feature: TCGCards, model: TCGCardsListScreenModel = .init()) -> some View {
        NavigationStack { TCGCardsListScreen(model: model) }
            .environment(feature)
            .cardImageLoader(PreviewCardImageLoader(outcome: .success))
    }
}
