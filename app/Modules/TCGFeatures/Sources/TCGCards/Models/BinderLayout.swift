import Foundation
import TCGClient

enum BinderLayout {
    static let maximumDimension = 20

    static func capacity(columns: Int, rows: Int) -> Int? {
        guard (1...maximumDimension).contains(columns) else { return nil }
        guard (1...maximumDimension).contains(rows) else { return nil }
        return columns * rows
    }

    static func insertingEmptyPage(
        in collection: CardBinderCollection,
        before pageID: UUID,
        pageID newPageID: UUID
    ) -> CardBinderCollection? {
        guard let index = collection.pages.firstIndex(where: { $0.id == pageID }) else { return nil }
        guard !collection.pages.contains(where: { $0.id == newPageID }) else { return nil }
        var updated = collection
        updated.pages.insert(BinderPage(id: newPageID, slots: []), at: index)
        return updated
    }

    static func slot(in collection: CardBinderCollection, at position: BinderPosition) -> BinderSlot? {
        collection.pages.first(where: { $0.id == position.pageID })?.slots.first {
            $0.row == position.row && $0.column == position.column
        }
    }

    static func movingSlot(
        in collection: CardBinderCollection,
        from source: BinderPosition,
        to destination: BinderPosition
    ) -> CardBinderCollection? {
        guard source != destination else { return nil }
        guard contains(source, in: collection) else { return nil }
        guard contains(destination, in: collection) else { return nil }
        guard let moved = slot(in: collection, at: source) else { return nil }
        let displaced = slot(in: collection, at: destination)
        var updated = collection
        for index in updated.pages.indices {
            let pageID = updated.pages[index].id
            updated.pages[index].slots.removeAll {
                BinderPosition(pageID: pageID, row: $0.row, column: $0.column) == source
                    || BinderPosition(pageID: pageID, row: $0.row, column: $0.column) == destination
            }
            if pageID == destination.pageID {
                updated.pages[index].slots.append(
                    BinderSlot(
                        row: destination.row,
                        column: destination.column,
                        cardID: moved.cardID,
                        quantity: moved.quantity
                    )
                )
            }
            if pageID == source.pageID, let displaced {
                updated.pages[index].slots.append(
                    BinderSlot(
                        row: source.row,
                        column: source.column,
                        cardID: displaced.cardID,
                        quantity: displaced.quantity
                    )
                )
            }
        }
        return updated
    }

    private static func contains(_ position: BinderPosition, in collection: CardBinderCollection) -> Bool {
        (1...collection.rows).contains(position.row)
            && (1...collection.columns).contains(position.column)
            && collection.pages.contains { $0.id == position.pageID }
    }

    static func requiresResizeConfirmation(from original: CardBinderCollection, to resized: CardBinderCollection)
        -> Bool
    {
        guard original.columns != resized.columns || original.rows != resized.rows else { return false }
        return original.pages.contains { !$0.slots.isEmpty }
    }

    static func resized(_ collection: CardBinderCollection, columns: Int, rows: Int) -> CardBinderCollection? {
        guard let capacity = Self.capacity(columns: columns, rows: rows) else { return nil }
        var updated = collection
        updated.columns = columns
        updated.rows = rows
        updated.pages = []
        for page in collection.pages {
            var kept: [BinderSlot] = []
            var moved: [BinderSlot] = []
            for slot in page.slots.sorted(by: { ($0.row, $0.column) < ($1.row, $1.column) }) {
                if slot.row <= rows && slot.column <= columns { kept.append(slot) } else { moved.append(slot) }
            }
            updated.pages.append(BinderPage(id: page.id, slots: kept))
            for start in stride(from: 0, to: moved.count, by: capacity) {
                let end = min(start + capacity, moved.count)
                let slots = moved[start..<end].enumerated()
                    .map { index, slot in
                        BinderSlot(
                            row: index / columns + 1,
                            column: index % columns + 1,
                            cardID: slot.cardID,
                            quantity: slot.quantity
                        )
                    }
                updated.pages.append(BinderPage(id: UUID(), slots: slots))
            }
        }
        if updated.pages.isEmpty { updated.pages = [BinderPage(id: UUID(), slots: [])] }
        return updated
    }
}
