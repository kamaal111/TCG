import Testing

@testable import TCGCards
@testable import TCGClient

@MainActor
struct TCGCollectionsTests {
    @Test func `Creating a collection from a card draft preserves the draft and the browsed collection`() async throws {
        let context = try await CollectionTestFixtures.selectedContext()
        let previous = try #require(context.collections.selectedID)
        let model = TCGCardFormScreenModel(
            mode: .add,
            initialValues: .init(pricedCard: PreviewTCGPricingClient.samplePricedCards[0])
        )
        model.configureCollection(currentID: previous, unfiledID: context.collections.unfiled?.id)
        model.values.quantities = [.nearMint: 3]
        model.values.notes = "Keep this draft"
        var expected = model.values
        try await model.createCollection(name: " Favorites ", using: context.collections).get()
        let destination = try #require(model.values.collectionID)
        expected.collectionID = destination
        #expect(model.values == expected)
        #expect(destination != previous)
        #expect(context.collections.collections.first(where: { $0.id == destination })?.name == "Favorites")
        #expect(context.collections.selectedID == previous)
        #expect(context.cards.selectedCollection?.id == previous)
        #expect(!context.collections.isWorking)
        await context.collections.reload(using: context.cards)
        #expect(context.collections.collections.contains(where: { $0.id == destination }))
        #expect(model.values == expected)
    }

    @Test func `Creating and deleting a collection changes selection and falls back to All cards`() async throws {
        let context = try await CollectionTestFixtures.selectedContext()
        let cards = context.cards
        let collections = context.collections
        await collections.select(nil, using: cards)
        #expect(collections.selected == nil)
        #expect(await collections.create(name: "Favorites", using: cards))
        let favorites = try #require(collections.selected)
        #expect(favorites.name == "Favorites")
        await collections.reload(using: cards)
        #expect(collections.selectedID == favorites.id)
        #expect(await collections.delete(favorites, using: cards))
        #expect(collections.selectedID == nil)
        #expect(cards.selectedCollection == nil)
    }

    @Test func `Switching between Binder and List preserves pages slots quantities and gaps`() async throws {
        let context = try await CollectionTestFixtures.selectedContext()
        let cards = context.cards
        let collections = context.collections
        var binder = try #require(collections.selected)
        binder.columns = 1
        binder.rows = 4
        binder.pages = [
            .init(
                id: CardsTestIDs.third,
                slots: [
                    .init(row: 2, column: 1, cardID: PreviewTCGCardsClient.sampleCards[0].id, quantity: 2)
                ]
            ),
            .init(id: CardsTestIDs.secondary, slots: []),
        ]
        #expect(await collections.save(binder, using: cards))
        let saved = try #require(collections.selected)
        collections.setView(.binder, for: saved.id)
        #expect(collections.view(for: saved.id) == .binder)
        collections.setView(.list, for: saved.id)
        #expect(collections.view(for: saved.id) == .list)
        collections.setView(.binder, for: saved.id)
        await collections.reload(using: cards)
        let reopened = try #require(collections.selected)
        #expect(collections.view(for: reopened.id) == .binder)
        #expect(reopened.revision == saved.revision)
        #expect(reopened.pages == binder.pages)
        #expect(reopened.columns == binder.columns)
        #expect(reopened.rows == binder.rows)
        #expect(!collections.isWorking)
        collections.clearSession()
        #expect(collections.view(for: saved.id) == .list)
    }

    @Test func `All cards includes unfiled and named collection entries after switching and reloading`() async throws {
        let context = await CollectionTestFixtures.loadedContext()
        #expect(context.collections.selectedID == nil)
        #expect(context.collections.namedCollections.isEmpty)
        let allIDs = Set(context.cards.cards.map(\.card.id))
        let card = try #require(context.cards.cards.first)
        #expect(await context.collections.create(name: "Favorites", using: context.cards))
        let collection = try #require(context.collections.selected)
        var values = CardFormValues(card: card.card)
        values.collectionID = collection.id
        _ = try await context.cards.updateCard(id: card.card.id, values: values).get()
        #expect(context.cards.cards.map(\.card.id) == [card.card.id])
        await context.collections.select(nil, using: context.cards)
        #expect(Set(context.cards.cards.map(\.card.id)) == allIDs)
        #expect(context.collections.selected == nil)
        await context.collections.reload(using: context.cards)
        #expect(context.collections.selectedID == nil)
        #expect(Set(context.cards.cards.map(\.card.id)) == allIDs)
        #expect(context.collections.namedCollections.map(\.id) == [collection.id])
    }

    @Test func `Searching All cards finds a card outside the last opened collection`() async throws {
        let context = try await CollectionTestFixtures.selectedContext()
        let selected = try #require(context.collections.selected)
        await context.collections.select(context.collections.unfiled?.id, using: context.cards)
        #expect(context.cards.cards.isEmpty)
        await context.collections.select(nil, using: context.cards)
        let model = TCGCardsListScreenModel(preferences: nil)
        model.query = "lUfFy"
        await model.load(using: context.cards)
        #expect(!context.cards.cards.isEmpty)
        #expect(context.cards.cards.allSatisfy { $0.card.collectionID == selected.id })
        #expect(context.cards.cards.allSatisfy { $0.card.name.localizedStandardContains("Luffy") })
        #expect(model.toast == nil)
    }

    @Test func `Adding from All cards defaults to Unfiled without dirtying the form`() {
        let model = TCGCardFormScreenModel(mode: .add, initialValues: nil)
        model.configureCollection(currentID: nil, unfiledID: CardsTestIDs.unfiledCollection)
        #expect(model.values.collectionID == CardsTestIDs.unfiledCollection)
        #expect(!model.hasUnsavedChanges)
    }

    @Test func `Choosing the default collection does not dirty an untouched card form`() {
        let model = TCGCardFormScreenModel(mode: .add, initialValues: nil)
        model.configureCollection(
            currentID: CardsTestIDs.favoritesCollection,
            unfiledID: CardsTestIDs.unfiledCollection
        )
        #expect(model.values.collectionID == CardsTestIDs.favoritesCollection)
        #expect(!model.hasUnsavedChanges)
        model.values.collectionID = CardsTestIDs.unfiledCollection
        #expect(model.hasUnsavedChanges)
    }

}
