import Foundation
import Testing

@testable import TCGCards
@testable import TCGClient

@Suite("TCGCards List Screen Model Tests")
@MainActor
struct TCGCardsListScreenModelTests {
    @Test
    func `Combines game and set selections without narrowing the choices`() async {
        let feature = TCGCards(client: .preview(cardsOutcome: .success(cards: PreviewTCGCardsClient.sampleCards)))
        let model = TCGCardsListScreenModel()
        model.setNames = ["Base Set"]
        await model.load(using: feature)
        #expect(feature.cards.map(\.card.id) == ["preview-card-2"])
        #expect(model.availableSetNames(using: feature) == ["Base Set", "Romance Dawn"])

        model.setNames.insert("Romance Dawn")
        await model.load(using: feature)
        #expect(feature.cards.map(\.card) == PreviewTCGCardsClient.sampleCards)

        model.gameFilter = .pokemon
        #expect(model.setNames.isEmpty)
        model.setNames = ["Romance Dawn"]
        await model.load(using: feature)
        #expect(feature.cards.isEmpty)
        #expect(model.availableSetNames(using: feature) == ["Base Set", "Romance Dawn"])

        model.setNames = []
        await model.load(using: feature)
        #expect(feature.cards.map(\.card.id) == ["preview-card-2"])
    }

    @Test
    func `Filtered deletion removes the displayed card and retains its selection`() async throws {
        let feature = TCGCards(client: .preview(cardsOutcome: .success(cards: PreviewTCGCardsClient.sampleCards)))
        let model = TCGCardsListScreenModel()
        model.setNames = ["Base Set"]
        await model.load(using: feature)

        await model.delete(at: IndexSet(integer: 0), using: feature)

        #expect(feature.cards.isEmpty)
        #expect(feature.availableSetNames == ["Romance Dawn"])
        #expect(model.setNames == ["Base Set"])
        #expect(model.availableSetNames(using: feature) == ["Base Set", "Romance Dawn"])
        model.setNames = []
        await model.load(using: feature)
        #expect(feature.cards.map(\.card.id) == ["preview-card-1"])
    }

    @Test
    func `Multiple deletion offsets are captured before reloading the collection`() async {
        let feature = TCGCards(client: .preview(cardsOutcome: .success(cards: PreviewTCGCardsClient.sampleCards)))
        let model = TCGCardsListScreenModel()
        await model.load(using: feature)

        await model.delete(at: IndexSet([0, 1]), using: feature)

        #expect(feature.cards.isEmpty)
        #expect(feature.availableSetNames.isEmpty)
    }

    @Test
    func `Adding outside the selected set refreshes choices without showing the new card`() async throws {
        let feature = TCGCards(client: .preview(cardsOutcome: .success(cards: PreviewTCGCardsClient.sampleCards)))
        let model = TCGCardsListScreenModel()
        model.gameFilter = .pokemon
        model.setNames = ["Base Set"]
        await model.load(using: feature)
        var values = validValues
        values.game = .pokemon
        values.setName = "Crown Zenith"

        try await feature.addCard(values).get()

        #expect(feature.cards.map(\.card.id) == ["preview-card-2"])
        #expect(feature.availableSetNames == ["Base Set", "Crown Zenith"])
    }

    @Test
    func `Loads all games by default`() async {
        let feature = TCGCards(client: .preview(cardsOutcome: .success(cards: PreviewTCGCardsClient.sampleCards)))
        let model = TCGCardsListScreenModel()

        await model.load(using: feature)

        #expect(model.gameFilter == nil)
        #expect(feature.cards.map(\.card) == PreviewTCGCardsClient.sampleCards)
    }

    @Test
    func `Switches games and restores the complete collection`() async {
        let feature = TCGCards(client: .preview(cardsOutcome: .success(cards: PreviewTCGCardsClient.sampleCards)))
        let model = TCGCardsListScreenModel()

        model.gameFilter = .pokemon
        await model.load(using: feature)
        #expect(feature.cards.map(\.card.game) == [.pokemon])

        model.gameFilter = .onePiece
        await model.load(using: feature)
        #expect(feature.cards.map(\.card.game) == [.onePiece])

        model.gameFilter = nil
        await model.load(using: feature)
        #expect(feature.cards.map(\.card) == PreviewTCGCardsClient.sampleCards)
    }
}
