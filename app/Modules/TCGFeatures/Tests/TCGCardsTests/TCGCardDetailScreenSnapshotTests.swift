import SwiftUI
import TCGDesignSystem
import TCGSnapshotTesting
import Testing

@testable import TCGCards
@testable import TCGClient

@Suite("Collection Detail Screen Snapshot Tests")
@MainActor
struct TCGCardDetailScreenSnapshotTests {
    @Test
    func `Renders purchase batch costs`() async {
        let source = PreviewTCGCardsClient.sampleCards[0]
        let card = Card(
            id: source.id,
            game: source.game,
            name: source.name,
            setName: source.setName,
            cardNumber: source.cardNumber,
            notes: nil,
            createdAt: source.createdAt,
            updatedAt: source.updatedAt,
            purchases: [
                .init(id: "batch-1", condition: .nearMint, quantity: 2, purchasePrice: 2, currency: .usd),
                .init(id: "batch-2", condition: .played, quantity: 1),
            ]
        )
        let model = TCGCardDetailScreenModel(card: .init(card: card, price: PreviewTCGCardsClient.price(for: card)))
        #expect(model.card.card.purchases.count == 2)
        await assertScreenSnapshot(testName: #function) { makeScreen(model) }
    }

    @Test
    func `Renders priced collection details`() async {
        let model = makeModel()
        #expect(model.editor == nil)
        await assertScreenSnapshot(testName: #function) { makeScreen(model) }
    }

    @Test
    func `Renders collection details without pricing`() async {
        let model = makeModel(status: .noPrice)
        #expect(model.card.price.price == nil)
        await assertScreenSnapshot(testName: #function) { makeScreen(model) }
    }

    @Test
    func `Renders unavailable collection pricing`() async {
        let model = makeModel(status: .unavailable)
        #expect(model.card.price.status == .unavailable)
        await assertScreenSnapshot(testName: #function) { makeScreen(model) }
    }

    @Test
    func `Renders editing with both save controls`() async {
        let model = makeModel()
        model.edit()
        #expect(model.editor != nil)
        await assertScreenSnapshot(testName: #function) { makeScreen(model) }
    }

    @Test
    func `Renders edit validation errors`() async throws {
        let model = makeModel()
        model.edit()
        let editor = try #require(model.editor)
        editor.values.name = ""
        await model.save(using: TCGCards(client: .preview(cardsOutcome: .empty)))
        #expect(editor.fieldErrors[.name] != nil)
        await assertScreenSnapshot(testName: #function) { makeScreen(model) }
    }

    private func makeModel(status: OwnedCardPriceStatus = .priced) -> TCGCardDetailScreenModel {
        let card = PreviewTCGCardsClient.sampleCards[0]
        let price =
            status == .priced ? PreviewTCGCardsClient.price(for: card) : OwnedCardPrice(cardId: card.id, status: status)
        return .init(card: .init(card: card, price: price))
    }

    private func makeScreen(_ model: TCGCardDetailScreenModel) -> some View {
        NavigationStack { TCGCardDetailScreen(model: model) }
            .environment(\.timeZone, TimeZone(secondsFromGMT: 0)!)
            .environment(TCGCards(client: .preview(cardsOutcome: .empty)))
            .cardImageLoader(PreviewCardImageLoader(outcome: .success))
    }
}
