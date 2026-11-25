import SwiftUI
import TCGCurrency
import TCGDesignSystem
import TCGSnapshotTesting
import Testing

@testable import TCGCards
@testable import TCGClient

@Suite("Collection Detail Screen Snapshot Tests")
@MainActor
struct TCGCardDetailScreenSnapshotTests {
    @Test
    func `Hides purchase costs and market pricing while preserving quantities`() async {
        let privacy = TCGPricePrivacy(defaults: nil)
        privacy.hidePrices = true
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
                .init(
                    id: nil,
                    condition: .nearMint,
                    quantity: 3,
                    purchasePrice: 5,
                    currency: .eur,
                    automaticPriceDate: nil,
                    displayPrice: nil
                )
            ],
            purchasePriceChangePercent: nil,
            displayCurrency: nil,
            collectionID: nil,
            allocationAdjustments: nil,
            illustrator: nil,
            englishSearchAlias: nil
        )
        let model = TCGCardDetailScreenModel(
            card: .init(card: card, price: PreviewTCGCardsClient.price(for: card), imageURL: nil)
        )
        #expect(model.card.card.purchases.first?.purchasePrice == 5)
        #expect(model.card.card.totalQuantity == 3)
        await assertScreenSnapshot(testName: #function, fileID: #fileID, file: #filePath, line: #line, column: #column)
        {
            makeScreen(model, isEditingCollection: false, cards: TCGCards(client: .preview(cardsOutcome: .empty)))
                .environment(\.tcgPricePrivacy, privacy)
                .environment(\.tcgCurrency, TCGCurrency(client: .preview(hasValidCredentials: false), defaults: nil))
        }
    }

    @Test
    func `Hides unavailable pricing in collection details`() async {
        let privacy = TCGPricePrivacy(defaults: nil)
        privacy.hidePrices = true
        let model = makeModel(status: .unavailable)
        #expect(model.card.price?.status == .unavailable)
        await assertScreenSnapshot(testName: #function, fileID: #fileID, file: #filePath, line: #line, column: #column)
        {
            makeScreen(model, isEditingCollection: false, cards: TCGCards(client: .preview(cardsOutcome: .empty)))
                .environment(\.tcgPricePrivacy, privacy)
        }
    }

    @Test
    func `Renders known illustrator while current pricing is unavailable`() async {
        let source = PreviewTCGCardsClient.sampleCards[1]
        let card = Card(
            id: source.id,
            game: .pokemon,
            name: source.name,
            setName: source.setName,
            cardNumber: source.cardNumber,
            notes: nil,
            createdAt: source.createdAt,
            updatedAt: source.updatedAt,
            purchases: [],
            purchasePriceChangePercent: nil,
            displayCurrency: nil,
            collectionID: nil,
            allocationAdjustments: nil,
            illustrator: "Mitsuhiro Arita",
            englishSearchAlias: nil
        )
        let model = TCGCardDetailScreenModel(
            card: .init(
                card: card,
                price: .init(cardId: card.id, status: .unavailable, price: nil, valuation: nil),
                imageURL: nil
            )
        )
        #expect(model.card.card.illustrator == "Mitsuhiro Arita")
        await assertScreenSnapshot(testName: #function, fileID: #fileID, file: #filePath, line: #line, column: #column)
        { makeScreen(model, isEditingCollection: false, cards: TCGCards(client: .preview(cardsOutcome: .empty))) }
    }

    @Test
    func `Renders the English name below illustrator`() async {
        let model = makeJapaneseCardModel(illustrator: "Mitsuhiro Arita")
        await assertScreenSnapshot(testName: #function, fileID: #fileID, file: #filePath, line: #line, column: #column)
        { makeScreen(model, isEditingCollection: false, cards: TCGCards(client: .preview(cardsOutcome: .empty))) }
    }

    @Test
    func `Renders the English name when illustrator is unavailable`() async {
        let model = makeJapaneseCardModel(illustrator: nil)
        await assertScreenSnapshot(testName: #function, fileID: #fileID, file: #filePath, line: #line, column: #column)
        { makeScreen(model, isEditingCollection: false, cards: TCGCards(client: .preview(cardsOutcome: .empty))) }
    }

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
                .init(
                    id: UUID(uuid: (0, 0, 0, 0, 0, 0, 64, 0, 128, 0, 0, 0, 0, 0, 1, 1)),
                    condition: .nearMint,
                    quantity: 2,
                    purchasePrice: 2,
                    currency: .usd,
                    automaticPriceDate: nil,
                    displayPrice: nil
                ),
                .init(
                    id: UUID(uuid: (0, 0, 0, 0, 0, 0, 64, 0, 128, 0, 0, 0, 0, 0, 1, 2)),
                    condition: .played,
                    quantity: 1,
                    purchasePrice: nil,
                    currency: nil,
                    automaticPriceDate: nil,
                    displayPrice: nil
                ),
            ],
            purchasePriceChangePercent: nil,
            displayCurrency: nil,
            collectionID: nil,
            allocationAdjustments: nil,
            illustrator: nil,
            englishSearchAlias: nil
        )
        let model = TCGCardDetailScreenModel(
            card: .init(card: card, price: PreviewTCGCardsClient.price(for: card), imageURL: nil)
        )
        #expect(model.card.card.purchases.count == 2)
        await assertScreenSnapshot(testName: #function, fileID: #fileID, file: #filePath, line: #line, column: #column)
        { makeScreen(model, isEditingCollection: false, cards: TCGCards(client: .preview(cardsOutcome: .empty))) }
    }

    @Test
    func `Renders priced collection details`() async {
        let model = makeModel(status: .priced)
        #expect(model.editor == nil)
        await assertScreenSnapshot(testName: #function, fileID: #fileID, file: #filePath, line: #line, column: #column)
        { makeScreen(model, isEditingCollection: false, cards: TCGCards(client: .preview(cardsOutcome: .empty))) }
    }

    @Test
    func `Renders collection details without pricing`() async {
        let model = makeModel(status: .noPrice)
        #expect(model.card.price?.price == nil)
        await assertScreenSnapshot(testName: #function, fileID: #fileID, file: #filePath, line: #line, column: #column)
        { makeScreen(model, isEditingCollection: false, cards: TCGCards(client: .preview(cardsOutcome: .empty))) }
    }

    @Test
    func `Renders unavailable collection pricing`() async {
        let model = makeModel(status: .unavailable)
        #expect(model.card.price?.status == .unavailable)
        await assertScreenSnapshot(testName: #function, fileID: #fileID, file: #filePath, line: #line, column: #column)
        { makeScreen(model, isEditingCollection: false, cards: TCGCards(client: .preview(cardsOutcome: .empty))) }
    }

    @Test
    func `Renders editing with both save controls`() async {
        let model = makeModel(status: .priced)
        model.edit()
        #expect(model.editor != nil)
        await assertScreenSnapshot(testName: #function, fileID: #fileID, file: #filePath, line: #line, column: #column)
        { makeScreen(model, isEditingCollection: true, cards: TCGCards(client: .preview(cardsOutcome: .empty))) }
    }

    @Test
    func `Renders edit validation errors`() async throws {
        let model = makeModel(status: .priced)
        model.edit()
        let editor = try #require(model.editor)
        editor.values.batches = []
        await model.save(using: TCGCards(client: .preview(cardsOutcome: .empty)))
        #expect(editor.fieldErrors[.quantities] != nil)
        await assertScreenSnapshot(testName: #function, fileID: #fileID, file: #filePath, line: #line, column: #column)
        { makeScreen(model, isEditingCollection: true, cards: TCGCards(client: .preview(cardsOutcome: .empty))) }
    }

    @Test func `Renders card editing access in collection edit mode`() async {
        let model = makeModel(status: .priced)
        #expect(model.editor == nil)
        await assertScreenSnapshot(testName: #function, fileID: #fileID, file: #filePath, line: #line, column: #column)
        { makeScreen(model, isEditingCollection: true, cards: TCGCards(client: .preview(cardsOutcome: .empty))) }
    }

    #if os(iOS)
        @Test func `Renders direct card editing outside collection edit mode`() async {
            let model = makeModel(status: .priced)
            model.edit()
            #expect(model.editor != nil)
            await assertScreenSnapshot(
                testName: #function,
                fileID: #fileID,
                file: #filePath,
                line: #line,
                column: #column
            ) { makeScreen(model, isEditingCollection: false, cards: TCGCards(client: .preview(cardsOutcome: .empty))) }
        }

        @Test func `Renders downloaded card details without editing controls`() async {
            let model = makeModel(status: .priced)
            let cards = TCGCards(client: .preview(cardsOutcome: .empty))
            cards.useDownloadedCards([model.card])
            #expect(cards.isReadOnly)
            await assertScreenSnapshot(
                testName: #function,
                fileID: #fileID,
                file: #filePath,
                line: #line,
                column: #column
            ) {
                makeScreen(model, isEditingCollection: true, cards: cards)
            }
        }
    #endif

    @Test
    func `Renders owned condition prices and estimates`() async {
        let card = PreviewTCGCardsClient.sampleCards[1]
        #expect(card.quantities.contains { $0.condition == .mint })
        let pricedOn = Date(timeIntervalSince1970: 1_750_000_000)
        let quotes = card.quantities.map { quantity in
            ConditionValue(
                condition: quantity.condition,
                currency: .usd,
                amount: 22.22,
                basis: .adjusted,
                conversionUnavailable: nil
            )
        }
        let priced = PricedCard(
            id: "owned-conditions",
            printingKey: nil,
            isWishlisted: nil,
            game: card.game,
            name: card.name,
            cardNumber: card.cardNumber,
            setName: nil,
            rarity: nil,
            illustrator: card.illustrator,
            englishSearchAlias: card.englishSearchAlias,
            variantName: nil,
            imageURL: nil,
            headline: nil,
            market: nil,
            conditionPrices: nil,
            conditionValues: quotes,
            display: nil,
            pricedOn: pricedOn,
            fetchedAt: pricedOn
        )
        let price = OwnedCardPrice(cardId: card.id, status: .priced, price: priced, valuation: nil)
        let model = TCGCardDetailScreenModel(card: .init(card: card, price: price, imageURL: nil))

        await assertScreenSnapshot(testName: #function, fileID: #fileID, file: #filePath, line: #line, column: #column)
        {
            makeScreen(model, isEditingCollection: false, cards: TCGCards(client: .preview(cardsOutcome: .empty)))
        }
    }

    @Test
    func `Renders graded-only owned details`() async {
        let card = PreviewTCGCardsClient.sampleCards[0]
        let pricedOn = Date(timeIntervalSince1970: 1_750_000_000)
        let priced = PricedCard(
            id: "graded-only",
            printingKey: nil,
            isWishlisted: nil,
            game: card.game,
            name: card.name,
            cardNumber: card.cardNumber,
            setName: nil,
            rarity: nil,
            illustrator: nil,
            englishSearchAlias: nil,
            variantName: nil,
            imageURL: nil,
            headline: nil,
            market: nil,
            conditionPrices: [],
            conditionValues: [],
            gradedPrices: [.init(company: "PSA", grade: 10, currency: .usd, low: 80, market: 100, population: nil)],
            display: nil,
            pricedOn: pricedOn,
            fetchedAt: pricedOn
        )
        let price = OwnedCardPrice(cardId: card.id, status: .noPrice, price: priced, valuation: nil)
        let model = TCGCardDetailScreenModel(card: .init(card: card, price: price, imageURL: nil))

        await assertScreenSnapshot(testName: #function, fileID: #fileID, file: #filePath, line: #line, column: #column)
        {
            makeScreen(model, isEditingCollection: false, cards: TCGCards(client: .preview(cardsOutcome: .empty)))
        }
    }

    private func makeJapaneseCardModel(illustrator: String?) -> TCGCardDetailScreenModel {
        let source = PreviewTCGCardsClient.sampleCards[1]
        let card = Card(
            id: source.id,
            game: .pokemon,
            name: "ダーテング",
            setName: "Cyber Judge",
            cardNumber: "072/071",
            notes: nil,
            createdAt: source.createdAt,
            updatedAt: source.updatedAt,
            purchases: [],
            purchasePriceChangePercent: nil,
            displayCurrency: nil,
            collectionID: nil,
            allocationAdjustments: nil,
            illustrator: illustrator,
            englishSearchAlias: "Shiftry"
        )
        return TCGCardDetailScreenModel(
            card: .init(
                card: card,
                price: .init(cardId: card.id, status: .unavailable, price: nil, valuation: nil),
                imageURL: nil
            )
        )
    }

    private func makeModel(status: OwnedCardPriceStatus) -> TCGCardDetailScreenModel {
        let card = PreviewTCGCardsClient.sampleCards[0]
        let price =
            status == .priced
            ? PreviewTCGCardsClient.price(for: card)
            : OwnedCardPrice(cardId: card.id, status: status, price: nil, valuation: nil)
        return .init(card: .init(card: card, price: price, imageURL: nil))
    }

    private func makeScreen(
        _ model: TCGCardDetailScreenModel,
        isEditingCollection: Bool,
        cards: TCGCards
    ) -> some View {
        TCGCardDetailScreen(model: model)
            .environment(\.isEditingCollection, isEditingCollection)
            .environment(\.timeZone, TimeZone(secondsFromGMT: 0)!)
            .environment(cards)
            .cardImageLoader(PreviewCardImageLoader(outcome: .success))
    }
}
