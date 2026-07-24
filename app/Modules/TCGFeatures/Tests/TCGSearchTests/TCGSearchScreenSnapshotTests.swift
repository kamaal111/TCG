//
//  TCGSearchScreenSnapshotTests.swift
//  TCGFeatures
//

import SwiftUI
import TCGSnapshotTesting
import Testing

@testable import TCGClient
@testable import TCGSearch

@Suite("TCGSearch Screen Snapshot Tests")
@MainActor
struct TCGSearchScreenSnapshotTests {
    @Test
    func `Renders pricing results`() async throws {
        let feature = TCGSearch(client: .preview(pricingOutcome: .success))
        let model = TCGSearchScreenModel()
        model.query = "Giratina"
        model.game = .pokemon
        try await feature.search(game: model.game, query: model.query).get()

        assertScreenSnapshot(testName: #function) { makeScreen(feature: feature, model: model) }
    }

    @Test
    func `Renders an empty search`() {
        let feature = TCGSearch(client: .preview(pricingOutcome: .empty))

        assertScreenSnapshot(testName: #function) {
            makeScreen(feature: feature, model: TCGSearchScreenModel())
        }
    }

    @Test
    func `Renders no results guidance`() async throws {
        let feature = TCGSearch(client: .preview(pricingOutcome: .noResults))
        let model = TCGSearchScreenModel()
        model.query = "Missing card"
        try await feature.search(game: model.game, query: model.query).get()

        assertScreenSnapshot(testName: #function) { makeScreen(feature: feature, model: model) }
    }

    private func makeScreen(feature: TCGSearch, model: TCGSearchScreenModel) -> some View {
        NavigationStack { TCGSearchScreen(model: model) }.environment(feature)
    }
}
