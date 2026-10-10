//
//  TCGCardsListScreenSnapshotTests.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/20/26.
//

import Foundation
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
    func `Renders purchase gains losses and stable cards`() async {
        let samples = [
            purchaseCard(id: "gain", change: 25), purchaseCard(id: "loss", change: -25),
            purchaseCard(id: "stable", change: 0), purchaseCard(id: "unknown", change: nil),
        ]
        let feature = TCGCards(client: .preview(cardsOutcome: .success(cards: samples)))
        let model = TCGCardsListScreenModel(preferences: nil)
        await model.load(using: feature)
        #expect(feature.cards.count == 4)
        await assertScreenSnapshot(testName: #function) { makeScreen(feature: feature, model: model) }
    }

    private func purchaseCard(id: String, change: Double?) -> Card {
        let source = PreviewTCGCardsClient.sampleCards[0]
        return Card(
            id: id,
            game: source.game,
            name: source.name,
            setName: source.setName,
            cardNumber: source.cardNumber,
            notes: nil,
            createdAt: source.createdAt,
            updatedAt: source.updatedAt,
            purchases: source.purchases,
            purchasePriceChangePercent: change
        )
    }

    @Test
    func `Renders a selected set`() async throws {
        let suiteName = "TCGCardsSnapshotTests.\(UUID().uuidString)"
        let preferences = try #require(UserDefaults(suiteName: suiteName))
        defer { preferences.removePersistentDomain(forName: suiteName) }
        let saved = TCGCardsListScreenModel(preferences: preferences)
        saved.gameFilter = .pokemon
        saved.setNames = ["Base Set"]
        let model = TCGCardsListScreenModel(preferences: preferences)
        let feature = TCGCards(client: .preview(cardsOutcome: .success(cards: PreviewTCGCardsClient.sampleCards)))
        await model.resumeLoadIfNeeded(using: feature)
        #expect(feature.cards.map(\.card.id) == ["preview-card-2"])
        await assertScreenSnapshot(testName: #function) { makeScreen(feature: feature, model: model) }
    }

    @Test
    func `Renders multiple selected sets`() async {
        let feature = TCGCards(client: .preview(cardsOutcome: .success(cards: PreviewTCGCardsClient.sampleCards)))
        let model = TCGCardsListScreenModel(preferences: nil)
        model.setNames = ["Base Set", "Romance Dawn"]
        await model.load(using: feature)
        #expect(feature.cards.count == 2)
        await assertScreenSnapshot(testName: #function) { makeScreen(feature: feature, model: model) }
    }

    @Test
    func `Renders no matching sets`() async {
        let feature = TCGCards(client: .preview(cardsOutcome: .success(cards: PreviewTCGCardsClient.sampleCards)))
        let model = TCGCardsListScreenModel(preferences: nil)
        model.setNames = ["Crown Zenith"]
        await model.load(using: feature)
        #expect(feature.cards.isEmpty)
        await assertScreenSnapshot(testName: #function) { makeScreen(feature: feature, model: model) }
    }

    @Test
    func `Renders selected sets with large text`() async {
        let feature = TCGCards(client: .preview(cardsOutcome: .success(cards: PreviewTCGCardsClient.sampleCards)))
        let model = TCGCardsListScreenModel(preferences: nil)
        model.setNames = ["Base Set", "Romance Dawn"]
        await model.load(using: feature)
        #expect(feature.cards.count == 2)
        await assertScreenSnapshot(testName: #function) {
            makeScreen(feature: feature, model: model).environment(\.dynamicTypeSize, .accessibility3)
        }
    }

    @Test
    func `Renders a populated collection`() async throws {
        let feature = TCGCards(client: .preview(cardsOutcome: .success(cards: PreviewTCGCardsClient.sampleCards)))
        let model = TCGCardsListScreenModel(preferences: nil)
        await model.load(using: feature)
        #expect(feature.cards.count == 2)
        await assertScreenSnapshot(testName: #function) { makeScreen(feature: feature, model: model) }
    }

    @Test
    func `Renders an empty collection`() async throws {
        let feature = TCGCards(client: .preview(cardsOutcome: .empty))
        let model = TCGCardsListScreenModel(preferences: nil)
        await model.load(using: feature)
        #expect(feature.cards.isEmpty)
        #expect(model.toast == nil)
        await assertScreenSnapshot(testName: #function) { makeScreen(feature: feature, model: model) }
    }

    @Test
    func `Renders a One Piece filter`() async {
        let feature = TCGCards(client: .preview(cardsOutcome: .success(cards: PreviewTCGCardsClient.sampleCards)))
        let model = TCGCardsListScreenModel(preferences: nil)
        model.gameFilter = .onePiece
        await model.load(using: feature)
        #expect(feature.cards.map(\.card.game) == [.onePiece])
        await assertScreenSnapshot(testName: #function) { makeScreen(feature: feature, model: model) }
    }

    @Test
    func `Renders a Pokemon filter`() async {
        let feature = TCGCards(client: .preview(cardsOutcome: .success(cards: PreviewTCGCardsClient.sampleCards)))
        let model = TCGCardsListScreenModel(preferences: nil)
        model.gameFilter = .pokemon
        await model.load(using: feature)
        #expect(feature.cards.map(\.card.game) == [.pokemon])
        await assertScreenSnapshot(testName: #function) { makeScreen(feature: feature, model: model) }
    }

    @Test
    func `Renders the game filter with large text`() async throws {
        let feature = TCGCards(client: .preview(cardsOutcome: .success(cards: PreviewTCGCardsClient.sampleCards)))
        let model = TCGCardsListScreenModel(preferences: nil)
        await model.load(using: feature)
        #expect(feature.cards.count == 2)
        await assertScreenSnapshot(testName: #function) {
            makeScreen(feature: feature, model: model)
                .environment(\.dynamicTypeSize, .accessibility3)
        }
    }

    @Test
    func `Renders a collection with some unavailable prices`() async throws {
        let feature = makeUnavailableFeature(allUnavailable: false)
        let model = TCGCardsListScreenModel(preferences: nil)
        await model.load(using: feature)
        #expect(feature.cards.map(\.price.status) == [.unavailable, .priced])
        await assertScreenSnapshot(testName: #function) { makeScreen(feature: feature, model: model) }
    }

    @Test
    func `Renders a collection with all prices unavailable`() async throws {
        let feature = makeUnavailableFeature(allUnavailable: true)
        let model = TCGCardsListScreenModel(preferences: nil)
        await model.load(using: feature)
        #expect(feature.cards.allSatisfy { $0.price.status == .unavailable })
        await assertScreenSnapshot(testName: #function) { makeScreen(feature: feature, model: model) }
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

    private func makeScreen(feature: TCGCards, model: TCGCardsListScreenModel) -> some View {
        NavigationStack { TCGCardsListScreen(model: model) }
            .environment(feature)
            .cardImageLoader(PreviewCardImageLoader(outcome: .success))
    }
}
