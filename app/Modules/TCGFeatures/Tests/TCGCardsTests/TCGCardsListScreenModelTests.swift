import Testing

@testable import TCGCards
@testable import TCGClient

@Suite("TCGCards List Screen Model Tests")
@MainActor
struct TCGCardsListScreenModelTests {
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
