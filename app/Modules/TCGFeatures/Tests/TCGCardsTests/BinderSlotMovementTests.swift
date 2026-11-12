import Foundation
import Testing

@testable import TCGCards
@testable import TCGClient

struct BinderSlotMovementTests {
    private let first = CardsTestIDs.secondary
    private let second = CardsTestIDs.third
    private let luffy = CardsTestIDs.splitCard
    private let zoro = CardsTestIDs.overflowCard

    @Test(arguments: [0, 1, 2])
    func `Inserting before a page preserves its identity contents and surrounding pages`(index: Int) throws {
        let original = binder()
        let newID = CardsTestIDs.secondOverflowCard
        let updated = try #require(
            BinderLayout.insertingEmptyPage(in: original, before: original.pages[index].id, pageID: newID)
        )
        #expect(updated.pages[index] == BinderPage(id: newID, slots: []))
        #expect(updated.pages.filter { $0.id != newID } == original.pages)
        #expect(updated.allocatedCopies(of: luffy) == 3)
        #expect(updated.columns == original.columns)
        #expect(updated.rows == original.rows)
        #expect(original.pages.count == 3)
    }

    @Test func `Insertion rejects missing target and duplicate page identity`() {
        let original = binder()
        #expect(BinderLayout.insertingEmptyPage(in: original, before: UUID(), pageID: UUID()) == nil)
        #expect(BinderLayout.insertingEmptyPage(in: original, before: first, pageID: second) == nil)
    }

    @Test(arguments: [CardsTestIDs.secondary, CardsTestIDs.third])
    func `Moving three copies to an empty slot clears only the source`(destinationPage: UUID) throws {
        let original = binder()
        let destination = position(page: destinationPage, row: 2, column: 2)
        let updated = try #require(BinderLayout.movingSlot(in: original, from: position(page: first), to: destination))
        #expect(BinderLayout.slot(in: updated, at: position(page: first)) == nil)
        #expect(BinderLayout.slot(in: updated, at: destination)?.cardID == luffy)
        #expect(BinderLayout.slot(in: updated, at: destination)?.quantity == 3)
        #expect(updated.allocatedCopies(of: luffy) == original.allocatedCopies(of: luffy))
        #expect(updated.allocatedCopies(of: zoro) == original.allocatedCopies(of: zoro))
        #expect(updated.pages.map(\.id) == original.pages.map(\.id))
        #expect(BinderLayout.slot(in: original, at: position(page: first))?.quantity == 3)
    }

    @Test(arguments: [CardsTestIDs.secondary, CardsTestIDs.third])
    func `Swapping occupied slots preserves both cards and unequal quantities`(destinationPage: UUID) throws {
        let original = binder()
        let destination = position(page: destinationPage, row: 1, column: 2)
        let updated = try #require(BinderLayout.movingSlot(in: original, from: position(page: first), to: destination))
        #expect(BinderLayout.slot(in: updated, at: position(page: first))?.cardID == zoro)
        #expect(BinderLayout.slot(in: updated, at: position(page: first))?.quantity == 2)
        #expect(BinderLayout.slot(in: updated, at: destination)?.cardID == luffy)
        #expect(BinderLayout.slot(in: updated, at: destination)?.quantity == 3)
        #expect(updated.allocatedCopies(of: luffy) == 3)
        #expect(updated.allocatedCopies(of: zoro) == 4)
        #expect(updated.pages.map(\.slots.count).reduce(0, +) == 3)
    }

    @Test func `Same card swaps quantities without merging`() throws {
        var original = binder()
        original.pages[1].slots = [.init(row: 1, column: 2, cardID: luffy, quantity: 1)]
        let destination = position(page: second, row: 1, column: 2)
        let updated = try #require(BinderLayout.movingSlot(in: original, from: position(page: first), to: destination))
        #expect(BinderLayout.slot(in: updated, at: position(page: first))?.quantity == 1)
        #expect(BinderLayout.slot(in: updated, at: destination)?.quantity == 3)
        #expect(updated.allocatedCopies(of: luffy) == 4)
    }

    @Test func `Invalid coordinates missing pages empty sources and same position are rejected`() {
        let original = binder()
        #expect(BinderLayout.movingSlot(in: original, from: position(page: first), to: position(page: first)) == nil)
        #expect(BinderLayout.movingSlot(in: original, from: position(page: first), to: position(page: UUID())) == nil)
        #expect(
            BinderLayout.movingSlot(in: original, from: position(page: first), to: position(page: second, row: 0))
                == nil
        )
        #expect(
            BinderLayout.movingSlot(in: original, from: position(page: first), to: position(page: second, column: 3))
                == nil
        )
        #expect(BinderLayout.movingSlot(in: original, from: position(page: second), to: position(page: first)) == nil)
        #expect(
            BinderLayout.movingSlot(in: original, from: position(page: first, row: 3), to: position(page: second))
                == nil
        )
    }

    private func binder() -> CardBinderCollection {
        CollectionTestFixtures.collection(
            columns: 2,
            rows: 2,
            pages: [
                .init(
                    id: first,
                    slots: [
                        .init(row: 1, column: 1, cardID: luffy, quantity: 3),
                        .init(row: 1, column: 2, cardID: zoro, quantity: 2),
                    ]
                ),
                .init(id: second, slots: [.init(row: 1, column: 2, cardID: zoro, quantity: 2)]),
                .init(id: CardsTestIDs.primary, slots: []),
            ]
        )
    }

    private func position(page: UUID, row: Int = 1, column: Int = 1) -> BinderPosition {
        .init(pageID: page, row: row, column: column)
    }
}
