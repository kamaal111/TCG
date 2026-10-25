import Foundation
import TCGClient

enum BinderLayout {
    static let maximumDimension = 20

    static func capacity(columns: Int, rows: Int) -> Int? {
        guard (1...maximumDimension).contains(columns) else { return nil }
        guard (1...maximumDimension).contains(rows) else { return nil }
        return columns * rows
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
