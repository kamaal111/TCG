import Foundation
import Testing

@testable import TCGCards
@testable import TCGClient

@MainActor
struct BinderSlotEditorModelTests {
    @Test func `An empty slot starts with card choices rather than contents`() async throws {
        let context = try await CollectionTestFixtures.selectedContext()
        let collection = CollectionTestFixtures.binder(columns: 3, rows: 3)
        let model = BinderSlotEditorModel(
            collection: collection,
            position: .init(pageID: CollectionTestFixtures.emptyPage.id, row: 1, column: 2)
        )
        #expect(model.screen == .collectionCards)
        #expect(!model.canSave)
        await model.load(using: context.cards, collections: context.collections)
        #expect(!model.isLoading)
    }

    @Test func `Unfiled selection stays a draft until Save then moves the entry into the chosen slot`() async throws {
        let context = try await CollectionTestFixtures.emptyBinderContext()
        let saved = try #require(context.collections.selected)
        let model = BinderSlotEditorModel(
            collection: saved,
            position: .init(pageID: CollectionTestFixtures.emptyPage.id, row: 1, column: 2)
        )
        await model.load(using: context.cards, collections: context.collections)
        #expect(model.availableCards.isEmpty)
        await model.showCards(unfiled: true, using: context.cards, collections: context.collections)
        let selected = try #require(model.availableCards.first)
        model.choose(selected)
        #expect(model.screen == .contents)
        #expect(model.canSave)
        #expect(context.cards.cards.isEmpty)
        #expect(context.collections.selected == saved)
        model.quantity = 1
        #expect(await model.save(using: context.cards, collections: context.collections))
        let result = try #require(context.collections.selected)
        #expect(result.pages.first?.slots == [.init(row: 1, column: 2, cardID: selected.card.id, quantity: 1)])
        #expect(context.cards.cards.first?.card.collectionID == result.id)
        await model.showCards(unfiled: true, using: context.cards, collections: context.collections)
        #expect(!model.availableCards.contains { $0.card.id == selected.card.id })
    }

    @Test func `Occupied slots start with their current card and quantity`() async throws {
        let context = try await CollectionTestFixtures.selectedContext()
        let card = try #require(context.cards.cards.first)
        var collection = try #require(context.collections.selected)
        collection.pages = [
            .init(id: CardsTestIDs.secondary, slots: [.init(row: 1, column: 1, cardID: card.card.id, quantity: 2)])
        ]
        let model = BinderSlotEditorModel(
            collection: collection,
            position: .init(pageID: CardsTestIDs.secondary, row: 1, column: 1),
            card: card
        )
        await model.load(using: context.cards, collections: context.collections)
        #expect(model.screen == .contents)
        #expect(model.selectedCard?.card.id == card.card.id)
        #expect(model.quantity == 2)
        #expect(model.maximum == card.card.totalQuantity)
    }

    @Test func `Conflict preserves the draft and blocks another save until reload`() async throws {
        let context = try await CollectionTestFixtures.emptyBinderContext()
        let saved = try #require(context.collections.selected)
        let model = BinderSlotEditorModel(
            collection: saved,
            position: .init(pageID: CollectionTestFixtures.emptyPage.id, row: 1, column: 2)
        )
        await model.showCards(unfiled: true, using: context.cards, collections: context.collections)
        let selected = try #require(model.availableCards.first)
        model.choose(selected)
        #expect(await context.collections.save(saved, using: context.cards))
        #expect(await model.save(using: context.cards, collections: context.collections) == false)
        #expect(model.needsReload)
        #expect(model.selectedCard == selected)
        #expect(!model.canSave)
        #expect(await model.save(using: context.cards, collections: context.collections) == false)
        await model.reload(using: context.cards, collections: context.collections)
        #expect(!model.needsReload)
        #expect(model.selectedCard == nil)
        #expect(model.screen == .collectionCards)
    }

    @Test func `Add more loads only the first page and fetches later pages on demand`() async throws {
        let source = PreviewTCGCardsClient.sampleCards[0]
        let entries = (0..<52).map { index in
            Card(
                id: UUID(),
                game: source.game,
                name: "Card \(index)",
                setName: source.setName,
                cardNumber: "\(index)",
                notes: nil,
                createdAt: source.createdAt,
                updatedAt: source.updatedAt,
                purchases: source.purchases,
                collectionID: nil,
                allocationAdjustments: nil,
                illustrator: nil
            )
        }
        let client = TCGClient.preview(cardsOutcome: .success(cards: entries))
        let cards = TCGCards(client: client)
        let collections = TCGCollections(client: client, defaults: nil)
        await collections.reload(using: cards)
        #expect(await collections.create(name: "Favorites", using: cards))
        let collection = try #require(collections.selected)
        var values = CardFormValues(card: entries[0])
        values.collectionID = collection.id
        _ = try await cards.updateCard(id: entries[0].id, values: values).get()
        let model = BinderSlotEditorModel(
            collection: collection,
            position: .init(pageID: CardsTestIDs.secondary, row: 1, column: 1)
        )
        await model.showCards(unfiled: true, using: cards, collections: collections)
        #expect(model.availableCards.count == 50)
        #expect(model.hasMoreCards)
        #expect(!model.availableCards.contains { $0.card.id == entries[51].id })
        model.setQuery("Card 51")
        await model.search(using: cards, collections: collections)
        #expect(model.availableCards.map(\.card.id) == [entries[51].id])
        #expect(!model.hasMoreCards)
        model.setQuery("")
        await model.search(using: cards, collections: collections)
        #expect(model.availableCards.count == 50)
        await model.loadNextPage(using: cards)
        #expect(model.availableCards.count == 51)
        #expect(!model.hasMoreCards)
        #expect(Set(model.availableCards.map(\.card.id)) == Set(entries.dropFirst().map(\.id)))
        await model.loadNextPage(using: cards)
        #expect(model.availableCards.count == 51)
        #expect(collections.selectedID == collection.id)
        #expect(cards.selectedCollection?.id == collection.id)
    }

    @Test func `Copy bounds and returning to choices never persist a draft`() async throws {
        let context = try await CollectionTestFixtures.emptyBinderContext()
        let collection = try #require(context.collections.selected)
        let model = BinderSlotEditorModel(
            collection: collection,
            position: .init(pageID: CardsTestIDs.secondary, row: 1, column: 1)
        )
        await model.showCards(unfiled: true, using: context.cards, collections: context.collections)
        let card = try #require(model.availableCards.first)
        model.choose(card)
        model.quantity = 0
        #expect(!model.canSave)
        #expect(await model.save(using: context.cards, collections: context.collections) == false)
        model.quantity = model.maximum + 1
        #expect(!model.canSave)
        await model.showCards(unfiled: false, using: context.cards, collections: context.collections)
        #expect(model.screen == .collectionCards)
        #expect(context.collections.selected == collection)
        let unfiledID = try #require(context.collections.unfiled?.id)
        let unfiled = try await context.cards
            .cardPage(
                .init(game: nil, setNames: [], cursor: nil, collectionID: unfiledID, query: nil, illustrators: [])
            )
            .get()
        #expect(unfiled.cards.contains { $0.card.id == card.card.id })
    }

    @Test func `Concurrent save attempts move and place the card only once`() async throws {
        let context = try await CollectionTestFixtures.emptyBinderContext()
        let saved = try #require(context.collections.selected)
        let model = BinderSlotEditorModel(
            collection: saved,
            position: .init(pageID: CollectionTestFixtures.emptyPage.id, row: 1, column: 2)
        )
        await model.showCards(unfiled: true, using: context.cards, collections: context.collections)
        let selected = try #require(model.availableCards.first)
        model.choose(selected)
        async let first = model.save(using: context.cards, collections: context.collections)
        async let second = model.save(using: context.cards, collections: context.collections)
        let results = await [first, second]
        #expect(results.filter { $0 }.count == 1)
        #expect(context.collections.selected?.revision == saved.revision + 1)
        #expect(context.collections.selected?.pages.first?.slots.count == 1)
    }

    @Test func `Loading failure can retry without enabling an empty save`() async {
        let client = TCGClient.preview(cardsOutcome: .serverUnavailable)
        let cards = TCGCards(client: client)
        let collections = TCGCollections(client: client, defaults: nil)
        let collection = CollectionTestFixtures.binder(columns: 3, rows: 3)
        let model = BinderSlotEditorModel(
            collection: collection,
            position: .init(pageID: CollectionTestFixtures.emptyPage.id, row: 1, column: 2)
        )
        await model.load(using: cards, collections: collections)
        #expect(model.error != nil)
        #expect(!model.isLoading)
        #expect(!model.canSave)
        await model.load(using: cards, collections: collections)
        #expect(model.error != nil)
        #expect(!model.canSave)
    }
}
