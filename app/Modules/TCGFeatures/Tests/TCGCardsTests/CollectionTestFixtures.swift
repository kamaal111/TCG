import Testing

@testable import TCGCards
@testable import TCGClient

enum CollectionTestFixtures {
    static func collection(
        columns: Int = 3,
        rows: Int = 3,
        pages: [BinderPage] = []
    ) -> CardBinderCollection {
        CardBinderCollection(
            id: CardsTestIDs.primary,
            name: "Favorites",
            isUnfiled: false,
            columns: columns,
            rows: rows,
            revision: 0,
            pages: pages
        )
    }

    static let emptyPage = BinderPage(id: CardsTestIDs.secondary, slots: [])

    static func binder(columns: Int, rows: Int) -> CardBinderCollection {
        collection(columns: columns, rows: rows, pages: [emptyPage])
    }

    @MainActor
    static func loadedContext() async -> Context {
        let client = TCGClient.preview()
        let cards = TCGCards(client: client)
        let collections = TCGCollections(client: client, defaults: nil)
        await collections.reload(using: cards)
        return Context(cards: cards, collections: collections)
    }

    @MainActor
    static func selectedContext() async throws -> Context {
        let context = await loadedContext()
        let cards = context.cards.cards
        #expect(await context.collections.create(name: "Favorites", using: context.cards))
        let collection = try #require(context.collections.selected)
        for card in cards {
            var values = CardFormValues(card: card.card)
            values.collectionID = collection.id
            _ = try await context.cards.updateCard(id: card.card.id, values: values).get()
        }
        return context
    }

    struct Context {
        let cards: TCGCards
        let collections: TCGCollections
    }
}
