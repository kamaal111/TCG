import SwiftUI
import TCGDesignSystem
import TCGSnapshotTesting
import Testing

@testable import TCGCards
@testable import TCGClient

@Suite("TCG Collections Snapshot Tests")
@MainActor
struct TCGCollectionsSnapshotTests {
    @Test func `Renders binder artwork filling small and large slots`() async throws {
        let context = await CollectionTestFixtures.loadedContext()
        let card = try #require(context.cards.cards.first)
        let position = BinderPosition(pageID: CardsTestIDs.secondary, row: 1, column: 1)
        let slot = BinderSlot(row: 1, column: 1, cardID: card.card.id, quantity: 2)
        await assertCollectionSnapshot(testName: #function) {
            HStack(alignment: .top) {
                ForEach([80.0, 160.0], id: \.self) { width in
                    BinderSlotView(
                        content: .init(position: position, slot: slot, card: card, width: width),
                        select: {}
                    )
                }
            }
            .padding()
        }
    }

    @Test func `Renders binder card choices with artwork and the selected card`() async throws {
        let context = await CollectionTestFixtures.loadedContext()
        let first = try #require(context.cards.cards.first)
        #expect(context.cards.cards.count == 2)
        await assertCollectionSnapshot(testName: #function) {
            NavigationStack {
                BinderCardPicker(
                    content: .init(cards: context.cards.cards, selection: first.card.id),
                    query: .constant(""),
                    actions: .init(choose: { _ in }, addMore: {})
                )
            }
        }
    }

    @Test func `Renders an empty binder card chooser`() async {
        await assertCollectionSnapshot(testName: #function) {
            NavigationStack {
                BinderCardPicker(
                    content: .init(cards: [], selection: nil),
                    query: .constant(""),
                    actions: .init(choose: { _ in }, addMore: {})
                )
            }
        }
    }

    @Test func `Renders the binder card no matches message`() async {
        await assertCollectionSnapshot(testName: #function) {
            BinderCardPicker.EmptyMessage(hasError: false, hasQuery: true)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    @Test func `Renders a failed later binder card page without hiding choices`() async throws {
        let context = await CollectionTestFixtures.loadedContext()
        let first = try #require(context.cards.cards.first)
        await assertCollectionSnapshot(testName: #function) {
            NavigationStack {
                BinderCardPicker(
                    content: .init(cards: [first], selection: nil, hasMore: true, nextPageError: .serverUnavailable),
                    query: .constant(""),
                    actions: .init(choose: { _ in }, retryNext: {})
                )
            }
        }
    }

    @Test func `Renders empty slot choices directly with Add more`() async throws {
        let context = try await CollectionTestFixtures.emptyBinderContext()
        let collection = try #require(context.collections.selected)
        let model = BinderSlotEditorModel(
            collection: collection,
            position: .init(pageID: CardsTestIDs.secondary, row: 1, column: 2)
        )
        await model.load(using: context.cards, collections: context.collections)
        #expect(model.screen == .collectionCards)
        await assertCollectionSnapshot(testName: #function) {
            NavigationStack {
                BinderSlotEditor(model: model, collections: context.collections)
            }
            .environment(context.cards)
        }
    }

    @Test func `Renders unfiled card choices with a way back`() async throws {
        let context = try await CollectionTestFixtures.emptyBinderContext()
        let collection = try #require(context.collections.selected)
        let model = BinderSlotEditorModel(
            collection: collection,
            position: .init(pageID: CardsTestIDs.secondary, row: 1, column: 2)
        )
        await model.showCards(unfiled: true, using: context.cards, collections: context.collections)
        #expect(model.availableCards.count == 2)
        await assertCollectionSnapshot(testName: #function) {
            NavigationStack {
                BinderSlotEditor(model: model, collections: context.collections)
            }
            .environment(context.cards)
        }
    }

    @Test func `Renders unfiled selection copy confirmation before saving`() async throws {
        let context = try await CollectionTestFixtures.emptyBinderContext()
        let collection = try #require(context.collections.selected)
        let model = BinderSlotEditorModel(
            collection: collection,
            position: .init(pageID: CardsTestIDs.secondary, row: 1, column: 2)
        )
        await model.showCards(unfiled: true, using: context.cards, collections: context.collections)
        let card = try #require(model.availableCards.first)
        model.choose(card)
        #expect(model.canSave)
        await assertCollectionSnapshot(testName: #function) {
            NavigationStack {
                BinderSlotEditor(model: model, collections: context.collections)
            }
            .environment(context.cards)
        }
    }

    @Test func `Renders a retry when slot card loading fails`() async {
        let client = TCGClient.preview(cardsOutcome: .serverUnavailable)
        let cards = TCGCards(client: client)
        let collections = TCGCollections(client: client, defaults: nil)
        let collection = CollectionTestFixtures.binder(columns: 3, rows: 3)
        let model = BinderSlotEditorModel(
            collection: collection,
            position: .init(pageID: CardsTestIDs.secondary, row: 1, column: 2)
        )
        await model.load(using: cards, collections: collections)
        #expect(model.error != nil)
        await assertCollectionSnapshot(testName: #function) {
            NavigationStack { BinderSlotEditor(model: model, collections: collections) }.environment(cards)
        }
    }

    @Test func `Renders collection creation alongside a searched card draft`() async {
        let context = await CollectionTestFixtures.loadedContext()
        let model = TCGCardFormScreenModel(
            mode: .add,
            initialValues: .init(pricedCard: PreviewTCGPricingClient.samplePricedCards[0])
        )
        #expect(model.canChooseCollection)
        await assertCollectionSnapshot(testName: #function) {
            NavigationStack { TCGCardFormScreen(model: model) }
                .environment(context.cards)
                .environment(\.tcgCollections, context.collections)
        }
    }

    @Test func `Renders new collection naming without leaving the card draft`() async {
        let context = await CollectionTestFixtures.loadedContext()
        let model = TCGCardFormScreenModel(mode: .add, initialValues: nil)
        #expect(context.collections.collections.count == 1)
        await assertCollectionSnapshot(testName: #function) {
            NavigationStack {
                NewCollectionScreen { name in
                    await model.createCollection(name: name, using: context.collections)
                }
            }
        }
    }

    @Test func `Renders the collection switcher and desktop sidebar`() async {
        let context = await CollectionTestFixtures.loadedContext()
        let cards = context.cards
        let collections = context.collections
        #expect(collections.collections.count == 1)
        await assertCollectionSnapshot(testName: #function) {
            TCGCollectionsScreen().environment(cards).environment(\.tcgCollections, collections)
        }
    }

    @Test func `Renders page creation in a binder without pages while browsing`() async {
        let collection = CollectionTestFixtures.collection()
        #expect(collection.pages.isEmpty)
        await assertCollectionSnapshot(testName: #function) {
            NavigationStack { TCGBinderScreen(collection: collection) }.environment(TCGCards(client: .preview()))
        }
    }

    @Test func `Renders a two by two binder adapting to the available width`() async {
        let collection = CollectionTestFixtures.collection(
            columns: 2,
            rows: 2,
            pages: [.init(id: CardsTestIDs.secondary, slots: []), .init(id: CardsTestIDs.third, slots: [])]
        )
        #expect(collection.pages.count == 2)
        await assertCollectionSnapshot(testName: #function) {
            NavigationStack { TCGBinderScreen(collection: collection) }.environment(TCGCards(client: .preview()))
        }
    }

    @Test func `Renders a custom one column four row empty binder`() async {
        let collection = CollectionTestFixtures.binder(columns: 1, rows: 4)
        #expect(collection.columns * collection.rows == 4)
        await assertCollectionSnapshot(testName: #function) {
            NavigationStack { TCGBinderScreen(collection: collection) }.environment(TCGCards(client: .preview()))
        }
    }

    @Test func `Renders a wide four column one row empty binder`() async {
        let collection = CollectionTestFixtures.binder(columns: 4, rows: 1)
        #expect(collection.pages.count == 1)
        await assertCollectionSnapshot(testName: #function) {
            NavigationStack { TCGBinderScreen(collection: collection) }.environment(TCGCards(client: .preview()))
        }
    }

    @Test func `Renders binder editing controls without filters`() async {
        let collection = CollectionTestFixtures.binder(columns: 3, rows: 3)
        #expect(collection.pages.count == 1)
        await assertCollectionSnapshot(testName: #function) {
            NavigationStack { TCGBinderScreen(collection: collection) }
                .environment(TCGCards(client: .preview()))
                .environment(\.isEditingCollection, true)
        }
    }

    @Test func `Renders read only binder pages without mutation controls`() async {
        let collection = CollectionTestFixtures.binder(columns: 2, rows: 2)
        let cards = TCGCards(client: .preview())
        cards.useDownloadedCards([])
        #expect(cards.isReadOnly)
        await assertCollectionSnapshot(testName: #function) {
            NavigationStack { TCGBinderScreen(collection: collection) }.environment(cards)
        }
    }

    @Test func `Renders a selected collection in list mode`() async throws {
        let context = try await CollectionTestFixtures.selectedContext()
        let collection = try #require(context.collections.selected)
        context.collections.setView(.list, for: collection.id)
        try #require(!context.cards.cards.isEmpty)

        await assertCollectionSnapshot(testName: #function) {
            TCGCollectionsScreen()
                .environment(context.cards)
                .environment(\.tcgCollections, context.collections)
        }
    }

    @Test func `Renders explicit collection edit mode`() async throws {
        let context = try await CollectionTestFixtures.selectedContext()
        #expect(context.collections.selected != nil)
        await assertCollectionSnapshot(testName: #function) {
            NavigationStack {
                CollectionContentView(
                    collections: context.collections,
                    actions: .init(create: {}, rename: { _ in }, delete: {}, editLayout: {}),
                    isEditing: .constant(true)
                )
            }
            .environment(context.cards)
            .environment(\.tcgCollections, context.collections)
            .environment(\.isEditingCollection, true)
        }
    }

    @Test func `Renders page dimension inputs and shortcuts`() async {
        let client = TCGClient.preview()
        let collection = CollectionTestFixtures.collection(columns: 1, rows: 4, pages: [])
        #expect(collection.rows == 4)
        await assertCollectionSnapshot(testName: #function) {
            NavigationStack {
                BinderLayoutEditor(collection: collection, collections: TCGCollections(client: client, defaults: nil))
            }
            .environment(TCGCards(client: client))
        }
    }

    @Test func `Renders collection export selection`() async {
        let context = await CollectionTestFixtures.loadedContext()
        let cards = context.cards
        let collections = context.collections
        #expect(await collections.create(name: "Favorites", using: cards))
        await assertCollectionSnapshot(testName: #function) {
            NavigationStack { CollectionExportScreen(collections: collections) }
        }
    }

    @Test func `Renders split quantity slot editing`() async throws {
        let context = try await CollectionTestFixtures.selectedContext()
        let cards = context.cards
        let collections = context.collections
        let page = BinderPage(
            id: CardsTestIDs.secondary,
            slots: [.init(row: 1, column: 1, cardID: PreviewTCGCardsClient.sampleCards[0].id, quantity: 2)]
        )
        var collection = try #require(context.collections.selected)
        collection.pages = [page]
        #expect(collection.allocatedCopies(of: PreviewTCGCardsClient.sampleCards[0].id) == 2)
        await assertCollectionSnapshot(testName: #function) {
            NavigationStack {
                BinderSlotEditor(
                    content: .init(
                        collection: collection,
                        position: .init(pageID: page.id, row: 1, column: 1),
                        card: context.cards.cards.first
                    ),
                    collections: collections
                )
                .environment(\.isEditingCollection, true)
            }
            .environment(cards)
        }
    }

    @Test func `Renders complete backup review`() async {
        let client = TCGClient.preview()
        let collection = CollectionTestFixtures.collection(
            columns: 1,
            rows: 4,
            pages: [
                .init(
                    id: CardsTestIDs.third,
                    slots: []
                )
            ]
        )
        let backup = CollectionBackup(version: 1, collections: [collection], cards: [])
        #expect(backup.collections.count == 1)
        await assertCollectionSnapshot(testName: #function) {
            NavigationStack {
                CollectionImportScreen(backup: backup, collections: TCGCollections(client: client, defaults: nil))
            }
            .environment(TCGCards(client: client))
        }
    }

    private func assertCollectionSnapshot<Screen: View>(testName: String, @ViewBuilder screen: () -> Screen) async {
        await assertScreenSnapshot(testName: testName) {
            screen().cardImageLoader(PreviewCardImageLoader(outcome: .success)).tint(.blue)
        }
    }

}
