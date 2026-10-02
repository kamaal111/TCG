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
    func `Renders an empty search`() async {
        let feature = TCGSearch(client: .preview(pricingOutcome: .empty))

        await assertScreenSnapshot(testName: #function) {
            makeScreen(feature: feature, model: TCGSearchScreenModel(preferences: nil))
        }
    }

    @Test
    func `Renders an empty One Piece search`() async {
        let feature = TCGSearch(client: .preview(pricingOutcome: .empty))
        let model = TCGSearchScreenModel(preferences: nil)
        model.game = .onePiece

        await assertScreenSnapshot(testName: #function) { makeScreen(feature: feature, model: model) }
    }

    @Test
    func `Renders no results guidance`() async throws {
        let feature = TCGSearch(client: .preview(pricingOutcome: .noResults))
        let model = TCGSearchScreenModel(preferences: nil)
        model.query = "Missing card"
        try await feature.search(game: model.game, query: model.query).get()

        await assertScreenSnapshot(testName: #function) { makeScreen(feature: feature, model: model) }
    }

    @Test
    func `Renders One Piece no results guidance`() async throws {
        let feature = TCGSearch(client: .preview(pricingOutcome: .noResults))
        let model = TCGSearchScreenModel(preferences: nil)
        model.game = .onePiece
        model.query = "OP99-999"
        try await feature.search(game: model.game, query: model.query).get()

        await assertScreenSnapshot(testName: #function) { makeScreen(feature: feature, model: model) }
    }

    @Test
    func `Renders a Japanese language filter`() async {
        let feature = TCGSearch(client: .preview(pricingOutcome: .empty))
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
            id: "missing-price", game: .onePiece, name: "Nami", cardNumber: "OP01-016",
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
            id: "details", game: .pokemon, name: "Giratina V", cardNumber: "186/196", rarity: "Special Art Rare",
            imageURL: URL(string: "https://images.example.com/giratina.png")!,
            headline: PriceHeadline(amount: 420, currency: .usd),
            market: MarketPrice(
                currency: .usd, low: 420, market: 450,
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
