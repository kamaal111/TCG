//
//  TCGSearchScreenSnapshotTests.swift
//  TCGFeatures
//

import SwiftUI
import TCGDesignSystem
import TCGSnapshotTesting
import Testing

@testable import TCGClient
@testable import TCGSearch

#if os(iOS)
    import UIKit
#endif

@Suite("TCGSearch Screen Snapshot Tests", .serialized)
@MainActor
struct TCGSearchScreenSnapshotTests {
    @Test
    func `Renders pricing results`() async throws {
        let feature = TCGSearch(client: .preview(pricingOutcome: .success))
        let model = TCGSearchScreenModel()
        model.query = "Giratina"
        model.game = .pokemon
        try await feature.search(game: model.game, query: model.query).get()

        #if os(iOS)
            let animationsWereEnabled = UIView.areAnimationsEnabled
        #endif

        await assertScreenSnapshot(testName: #function) { makeScreen(feature: feature, model: model) }

        #if os(iOS)
            #expect(UIView.areAnimationsEnabled == animationsWereEnabled)
        #endif
    }

    @Test
    func `Renders an empty search`() async {
        let feature = TCGSearch(client: .preview(pricingOutcome: .empty))

        await assertScreenSnapshot(testName: #function) {
            makeScreen(feature: feature, model: TCGSearchScreenModel())
        }
    }

    @Test
    func `Renders an empty One Piece search`() async {
        let feature = TCGSearch(client: .preview(pricingOutcome: .empty))
        let model = TCGSearchScreenModel()
        model.game = .onePiece

        await assertScreenSnapshot(testName: #function) { makeScreen(feature: feature, model: model) }
    }

    @Test
    func `Renders no results guidance`() async throws {
        let feature = TCGSearch(client: .preview(pricingOutcome: .noResults))
        let model = TCGSearchScreenModel()
        model.query = "Missing card"
        try await feature.search(game: model.game, query: model.query).get()

        await assertScreenSnapshot(testName: #function) { makeScreen(feature: feature, model: model) }
    }

    @Test
    func `Renders One Piece no results guidance`() async throws {
        let feature = TCGSearch(client: .preview(pricingOutcome: .noResults))
        let model = TCGSearchScreenModel()
        model.game = .onePiece
        model.query = "OP99-999"
        try await feature.search(game: model.game, query: model.query).get()

        await assertScreenSnapshot(testName: #function) { makeScreen(feature: feature, model: model) }
    }

    @Test
    func `Explains Pokemon names and set numbers`() async {
        await assertScreenSnapshot(testName: #function) { makeHelp(game: .pokemon) }
    }

    @Test
    func `Explains One Piece names and card numbers`() async {
        await assertScreenSnapshot(testName: #function) { makeHelp(game: .onePiece) }
    }

    @ViewBuilder
    private func makeHelp(game: ClientCardGame) -> some View {
        #if os(macOS)
            TCGSearchHelpView(game: game)
                .frame(width: 380)
        #else
            TCGSearchHelpView(game: game)
        #endif
    }

    private func makeScreen(feature: TCGSearch, model: TCGSearchScreenModel) -> some View {
        #if os(iOS)
            #expect(!UIView.areAnimationsEnabled)
        #endif

        return NavigationStack { TCGSearchScreen(model: model) }
            .environment(feature)
            .cardImageLoader(PreviewCardImageLoader(outcome: .success))
    }
}
