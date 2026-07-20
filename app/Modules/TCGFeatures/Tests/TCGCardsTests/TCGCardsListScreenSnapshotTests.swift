//
//  TCGCardsListScreenSnapshotTests.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/20/26.
//

import SwiftUI
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
        try await feature.loadCards().get()
        assertScreenSnapshot(testName: #function) { makeScreen(feature: feature) }
    }

    @Test
    func `Renders an empty collection`() async throws {
        let feature = TCGCards(client: .preview(cardsOutcome: .empty))
        try await feature.loadCards().get()
        assertScreenSnapshot(testName: #function) { makeScreen(feature: feature) }
    }

    @Test
    func `Renders a One Piece filter`() async throws {
        let feature = TCGCards(client: .preview(cardsOutcome: .success(cards: PreviewTCGCardsClient.sampleCards)))
        try await feature.loadCards().get()
        let model = TCGCardsListScreenModel()
        model.gameFilter = .onePiece
        assertScreenSnapshot(testName: #function) { makeScreen(feature: feature, model: model) }
    }

    private func makeScreen(feature: TCGCards, model: TCGCardsListScreenModel = .init()) -> some View {
        NavigationStack { TCGCardsListScreen(model: model) }.environment(feature)
    }
}
