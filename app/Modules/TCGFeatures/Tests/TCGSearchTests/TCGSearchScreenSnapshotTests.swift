//
//  TCGSearchScreenSnapshotTests.swift
//  TCGFeatures
//

import Foundation
import KamaalAuth
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
    func `Keeps pricing rows visible while refreshing`() async {
        let lightTransport = HistoryPricingTransport(suspended: true)
        let darkTransport = HistoryPricingTransport(suspended: true)
        let light = await makeRefreshingState(transport: lightTransport)
        let dark = await makeRefreshingState(transport: darkTransport)
        var states = [light, dark]

        await assertScreenSnapshot(testName: #function) {
            let state = states.removeFirst()
            #expect(state.feature.isSearching)
            #expect(state.feature.results.count == 1)
            return makeScreen(feature: state.feature, model: state.model)
        }

        await lightTransport.resume(count: 2)
        await darkTransport.resume(count: 2)
        await light.refresh.value
        await dark.refresh.value
    }

    private func makeRefreshingState(transport: HistoryPricingTransport) async -> (
        feature: TCGSearch, model: TCGSearchScreenModel, refresh: Task<Void, Never>
    ) {
        let feature = TCGSearch(
            client: .default(
                transport: transport,
                credentialsKeychainKey: "refresh-snapshot-credentials",
                credentialsStore: InMemoryCredentialsStore()
            ),
            history: TCGSearchHistoryStore()
        )
        let model = TCGSearchScreenModel(preferences: nil)
        model.query = "Giratina"
        let initial = Task { await model.performSearch(using: feature) }
        await transport.waitUntilStarted()
        await transport.resume()
        await initial.value
        let refresh = Task { await model.performSearch(using: feature) }
        await transport.waitUntilStarted(count: 2)
        return (feature, model, refresh)
    }

    @Test
    func `Renders pricing results`() async throws {
        let feature = TCGSearch(client: .preview(pricingOutcome: .success), history: TCGSearchHistoryStore())
        let model = TCGSearchScreenModel(preferences: nil)
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
    func `Renders one selected search set`() async {
        let state = await makeSetFilteredState(setNames: ["Crown Zenith"])
        #expect(state.model.filteredResults(using: state.feature).count == 2)
        await assertScreenSnapshot(testName: #function) { makeScreen(feature: state.feature, model: state.model) }
    }

    @Test
    func `Renders multiple selected search sets`() async {
        let state = await makeSetFilteredState(setNames: ["Crown Zenith", "Lost Origin"])
        #expect(state.model.filteredResults(using: state.feature).count == 3)
        await assertScreenSnapshot(testName: #function) { makeScreen(feature: state.feature, model: state.model) }
    }

    @Test
    func `Renders no matching search sets after refresh`() async {
        let state = await makeSetFilteredState(setNames: ["Crown Zenith"])
        await state.model.performSearch(using: state.feature)
        #expect(state.model.filteredResults(using: state.feature).isEmpty)
        #expect(state.feature.results.count == 1)
        await assertScreenSnapshot(testName: #function) { makeScreen(feature: state.feature, model: state.model) }
    }

    @Test
    func `Renders selected search sets with large text`() async {
        let state = await makeSetFilteredState(setNames: ["Crown Zenith", "Lost Origin"])
        #expect(state.model.setNames.count == 2)
        await assertScreenSnapshot(testName: #function) {
            makeScreen(feature: state.feature, model: state.model)
                .environment(\.dynamicTypeSize, .accessibility3)
        }
    }

    private func makeSetFilteredState(setNames: Set<String>) async -> (
        feature: TCGSearch, model: TCGSearchScreenModel
    ) {
        let transport = HistoryPricingTransport()
        await transport.setOutcome(.sets, for: 1)
        let feature = TCGSearch(
            client: .default(
                transport: transport,
                credentialsKeychainKey: "set-filter-snapshot-credentials",
                credentialsStore: InMemoryCredentialsStore()
            ),
            history: TCGSearchHistoryStore()
        )
        let model = TCGSearchScreenModel(preferences: nil)
        model.query = "Giratina"
        await model.performSearch(using: feature)
        model.setNames = setNames
        return (feature, model)
    }

    @Test
    func `Renders an empty search`() async {
        let feature = TCGSearch(client: .preview(pricingOutcome: .empty), history: TCGSearchHistoryStore())

        await assertScreenSnapshot(testName: #function) {
            makeScreen(feature: feature, model: TCGSearchScreenModel(preferences: nil))
        }
    }

    @Test
    func `Renders an empty One Piece search`() async {
        let feature = TCGSearch(client: .preview(pricingOutcome: .empty), history: TCGSearchHistoryStore())
        let model = TCGSearchScreenModel(preferences: nil)
        model.game = .onePiece

        await assertScreenSnapshot(testName: #function) { makeScreen(feature: feature, model: model) }
    }

    @Test
    func `Renders no results guidance`() async throws {
        let feature = TCGSearch(client: .preview(pricingOutcome: .noResults), history: TCGSearchHistoryStore())
        let model = TCGSearchScreenModel(preferences: nil)
        model.query = "Missing card"
        try await feature.search(game: model.game, query: model.query).get()

        await assertScreenSnapshot(testName: #function) { makeScreen(feature: feature, model: model) }
    }

    @Test
    func `Renders One Piece no results guidance`() async throws {
        let feature = TCGSearch(client: .preview(pricingOutcome: .noResults), history: TCGSearchHistoryStore())
        let model = TCGSearchScreenModel(preferences: nil)
        model.game = .onePiece
        model.query = "OP99-999"
        try await feature.search(game: model.game, query: model.query).get()

        await assertScreenSnapshot(testName: #function) { makeScreen(feature: feature, model: model) }
    }

    @Test
    func `Renders a Japanese language filter`() async {
        let feature = TCGSearch(client: .preview(pricingOutcome: .empty), history: TCGSearchHistoryStore())
        let model = TCGSearchScreenModel(preferences: nil)
        model.languages = [.japanese]

        #expect(model.languages == [.japanese])
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

    @Test
    func `Renders complete card details`() async {
        await assertScreenSnapshot(testName: #function) {
            TCGSearchDetailView(card: detailCard)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(.background)
                .environment(\.timeZone, TimeZone(secondsFromGMT: 0)!)
                .cardImageLoader(PreviewCardImageLoader(outcome: .success))
        }
    }

    @Test
    func `Renders card details without pricing or artwork`() async {
        let card = PricedCard(
            id: "missing-price",
            game: .onePiece,
            name: "Nami",
            cardNumber: "OP01-016",
            pricedOn: Date(timeIntervalSince1970: 1_750_000_000),
            fetchedAt: Date(timeIntervalSince1970: 1_750_000_000)
        )
        await assertScreenSnapshot(testName: #function) {
            TCGSearchDetailView(card: card)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(.background)
                .environment(\.timeZone, TimeZone(secondsFromGMT: 0)!)
        }
    }

    @Test
    func `Renders fitted image exploration`() async {
        await assertScreenSnapshot(testName: #function) {
            CardImageExplorer(url: detailCard.imageURL)
                .cardImageLoader(PreviewCardImageLoader(outcome: .success))
        }
    }

    @Test
    func `Renders failed image exploration with retry`() async {
        await assertScreenSnapshot(testName: #function) {
            CardImageExplorer(url: detailCard.imageURL)
                .cardImageLoader(PreviewCardImageLoader(outcome: .failure))
        }
    }

    @Test
    func `Renders image exploration while loading`() async {
        await assertScreenSnapshot(testName: #function) {
            CardImageExplorer(url: detailCard.imageURL)
                .cardImageLoader(SuspendedImageLoader())
        }
    }

    private var detailCard: PricedCard {
        PricedCard(
            id: "details",
            game: .pokemon,
            name: "Giratina V",
            cardNumber: "186/196",
            rarity: "Special Art Rare",
            imageURL: URL(string: "https://images.example.com/giratina.png")!,
            headline: PriceHeadline(amount: 420, currency: .usd),
            market: MarketPrice(
                currency: .usd,
                low: 420,
                market: 450,
                trend7d: PriceMovement(priceChange: 12, percentChange: 2.7),
                trend30d: PriceMovement(priceChange: -20, percentChange: -4.3)
            ),
            pricedOn: Date(timeIntervalSince1970: 1_750_000_000),
            fetchedAt: Date(timeIntervalSince1970: 1_750_000_000)
        )
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

    @Test
    func `Renders recent searches`() async {
        let feature = makeHistoryFeature()
        #expect(feature.history.entries(for: .pokemon).count == 6)
        await assertScreenSnapshot(testName: #function) {
            makeScreen(feature: feature, model: TCGSearchScreenModel(preferences: nil))
        }
    }

    @Test
    func `Renders matching history suggestions`() async throws {
        let feature = makeHistoryFeature()
        let model = TCGSearchScreenModel(preferences: nil)
        model.query = "Gira"
        model.isSearchFocused = true
        try await feature.search(game: .pokemon, query: model.query).get()
        #expect(feature.history.suggestions(for: model.query, game: model.game).count == 2)
        await assertScreenSnapshot(testName: #function) { makeScreen(feature: feature, model: model) }
    }

    @Test
    func `Renders full search history`() async {
        let feature = makeHistoryFeature()
        #expect(feature.history.entries(for: .pokemon).count == 6)
        await assertScreenSnapshot(testName: #function) { makeHistoryScreen(feature: feature) }
    }

    @Test
    func `Renders empty search history`() async {
        let feature = TCGSearch(client: .preview(pricingOutcome: .empty), history: TCGSearchHistoryStore())
        #expect(feature.history.entries.isEmpty)
        await assertScreenSnapshot(testName: #function) { makeHistoryScreen(feature: feature) }
    }

    @Test
    func `Renders recent searches with large text`() async {
        let feature = makeHistoryFeature()
        #expect(feature.history.entries(for: .pokemon).count == 6)
        await assertScreenSnapshot(testName: #function) {
            makeScreen(feature: feature, model: TCGSearchScreenModel(preferences: nil))
                .environment(\.dynamicTypeSize, .accessibility3)
        }
    }

    private func makeHistoryFeature() -> TCGSearch {
        let history = TCGSearchHistoryStore(now: { Date(timeIntervalSince1970: 1_753_267_800) })
        for query in ["sv5m 072/071", "Charizard ex 199", "Pikachu", "Giratina VSTAR GG69", "Giratina", "Eevee"] {
            history.record(query: query, game: .pokemon)
        }
        history.record(query: "Nami OP01-016", game: .onePiece)
        return TCGSearch(client: .preview(pricingOutcome: .success), history: history)
    }

    private func makeHistoryScreen(feature: TCGSearch) -> some View {
        NavigationStack {
            TCGSearchHistoryScreen(
                history: feature.history,
                game: .pokemon,
                onSelect: { _ in },
                onRemove: feature.history.remove,
                onClear: { feature.history.clear(game: .pokemon) }
            )
        }
    }

    private func makeScreen(feature: TCGSearch, model: TCGSearchScreenModel) -> some View {
        #if os(iOS)
            #expect(!UIView.areAnimationsEnabled)
        #endif

        return NavigationStack { TCGSearchScreen(model: model, onAdd: { _ in }) }
            .environment(feature)
            .cardImageLoader(PreviewCardImageLoader(outcome: .success))
    }
}

private struct SuspendedImageLoader: CardImageLoader {
    func cachedImage(for url: URL) -> Image? { nil }

    func image(for url: URL) async -> Image? {
        do {
            try await Task.sleep(for: .seconds(60))
        } catch {}
        return nil
    }
}
