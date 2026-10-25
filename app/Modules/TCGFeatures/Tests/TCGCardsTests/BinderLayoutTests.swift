import Testing

@testable import TCGCards
@testable import TCGClient

struct BinderLayoutTests {
    @Test func `Custom one by four dimensions preserve fitting coordinates and insert overflow before the next page`()
        throws
    {
        let first = BinderPage(
            id: CardsTestIDs.secondary,
            slots: [
                .init(
                    row: 1,
                    column: 1,
                    cardID: CardsTestIDs.splitCard,
                    quantity: 3
                ),
                .init(
                    row: 1,
                    column: 2,
                    cardID: CardsTestIDs.overflowCard,
                    quantity: 1
                ),
                .init(
                    row: 2,
                    column: 1,
                    cardID: CardsTestIDs.splitCard,
                    quantity: 1
                ),
                .init(
                    row: 3,
                    column: 3,
                    cardID: CardsTestIDs.secondOverflowCard,
                    quantity: 1
                ),
            ]
        )
        let collection = CollectionTestFixtures.collection(
            columns: 3,
            rows: 3,
            pages: [
                first,
                BinderPage(
                    id: CardsTestIDs.third,
                    slots: []
                ),
            ]
        )
        let resized = try #require(BinderLayout.resized(collection, columns: 1, rows: 4))
        #expect(resized.columns == 1)
        #expect(resized.rows == 4)
        #expect(resized.pages.count == 3)
        #expect(resized.pages[0].id == first.id)
        #expect(resized.pages[0].slots == [first.slots[0], first.slots[2]])
        #expect(
            resized.pages[1].slots == [
                .init(
                    row: 1,
                    column: 1,
                    cardID: CardsTestIDs.overflowCard,
                    quantity: 1
                ),
                .init(
                    row: 2,
                    column: 1,
                    cardID: CardsTestIDs.secondOverflowCard,
                    quantity: 1
                ),
            ]
        )
        #expect(
            resized.pages[2]
                == BinderPage(
                    id: CardsTestIDs.third,
                    slots: []
                )
        )
        #expect(resized.allocatedCopies(of: CardsTestIDs.splitCard) == 4)
        #expect(collection.pages.count == 2)
    }

    @Test func `Enlarging preserves gaps and empty pages`() throws {
        let page = BinderPage(
            id: CardsTestIDs.secondary,
            slots: [
                .init(
                    row: 2,
                    column: 2,
                    cardID: CardsTestIDs.splitCard,
                    quantity: 3
                )
            ]
        )
        let collection = CollectionTestFixtures.collection(
            columns: 2,
            rows: 2,
            pages: [
                page,
                .init(
                    id: CardsTestIDs.third,
                    slots: []
                ),
            ]
        )
        let resized = try #require(BinderLayout.resized(collection, columns: 7, rows: 3))
        #expect(resized.pages == collection.pages)
        #expect(resized.columns == 7)
        #expect(resized.rows == 3)
    }

    @Test(arguments: [(2, 2), (4, 4), (3, 4)])
    func `Resizing a populated binder requires confirmation`(dimensions: (Int, Int)) throws {
        let original = populatedCollection()
        let resized = try #require(BinderLayout.resized(original, columns: dimensions.0, rows: dimensions.1))
        #expect(BinderLayout.requiresResizeConfirmation(from: original, to: resized))
    }

    @Test func `An unchanged populated layout does not require confirmation`() throws {
        let original = populatedCollection()
        let resized = try #require(BinderLayout.resized(original, columns: 3, rows: 3))
        #expect(!BinderLayout.requiresResizeConfirmation(from: original, to: resized))
    }

    @Test func `Resizing empty pages does not require confirmation`() throws {
        let original = CollectionTestFixtures.binder(columns: 3, rows: 3)
        let resized = try #require(BinderLayout.resized(original, columns: 2, rows: 2))
        #expect(!BinderLayout.requiresResizeConfirmation(from: original, to: resized))
    }

    @Test func `Supports twenty columns and twenty rows with four hundred slots`() throws {
        let collection = CollectionTestFixtures.collection(columns: 3, rows: 3, pages: [])
        let resized = try #require(BinderLayout.resized(collection, columns: 20, rows: 20))
        #expect(resized.columns == 20)
        #expect(resized.rows == 20)
        #expect(BinderLayout.capacity(columns: 20, rows: 20) == 400)
    }

    @Test(arguments: [(0, 4), (4, 0), (-1, 2), (21, 20), (20, 21), (Int.max, Int.max)])
    func `Rejects dimensions outside one through twenty`(dimensions: (Int, Int)) {
        let collection = CollectionTestFixtures.collection(columns: 3, rows: 3, pages: [])
        #expect(BinderLayout.resized(collection, columns: dimensions.0, rows: dimensions.1) == nil)
    }

    private func populatedCollection() -> CardBinderCollection {
        CollectionTestFixtures.collection(
            columns: 3,
            rows: 3,
            pages: [
                BinderPage(
                    id: CardsTestIDs.secondary,
                    slots: [
                        .init(row: 3, column: 3, cardID: CardsTestIDs.splitCard, quantity: 3)
                    ]
                )
            ]
        )
    }

}
