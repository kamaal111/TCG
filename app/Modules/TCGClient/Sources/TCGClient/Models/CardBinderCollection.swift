import Foundation

public struct BinderSlot: Codable, Hashable, Sendable {
    public let row: Int
    public let column: Int
    public let cardID: Card.ID
    public let quantity: Int

    public init(row: Int, column: Int, cardID: Card.ID, quantity: Int) {
        self.row = row
        self.column = column
        self.cardID = cardID
        self.quantity = quantity
    }

    private enum CodingKeys: String, CodingKey {
        case row, column, quantity
        case cardID = "card_id"
    }
}

public struct BinderPage: Codable, Hashable, Identifiable, Sendable {
    public let id: UUID
    public var slots: [BinderSlot]

    public init(id: UUID, slots: [BinderSlot]) {
        self.id = id
        self.slots = slots
    }
}

public struct CardCollectionSummary: Codable, Hashable, Identifiable, Sendable {
    public let id: UUID
    public let name: String
    public let isUnfiled: Bool
    public let revision: Int

    private enum CodingKeys: String, CodingKey {
        case id, name, revision
        case isUnfiled = "is_unfiled"
    }
}

public struct CardBinderCollection: Codable, Hashable, Identifiable, Sendable {
    public let id: UUID
    public var name: String
    public let isUnfiled: Bool
    public var columns: Int
    public var rows: Int
    public var revision: Int
    public var pages: [BinderPage]

    public var summary: CardCollectionSummary {
        CardCollectionSummary(id: id, name: name, isUnfiled: isUnfiled, revision: revision)
    }

    public func allocatedCopies(of cardID: UUID) -> Int {
        pages.reduce(0) { sum, page in sum + page.slots.reduce(0) { $0 + ($1.cardID == cardID ? $1.quantity : 0) } }
    }

    private enum CodingKeys: String, CodingKey {
        case id, name, columns, rows, revision, pages
        case isUnfiled = "is_unfiled"
    }
}

public struct CollectionBackup: Codable, Sendable {
    public static let currentVersion = 1

    public let version: Int
    public let collections: [CardBinderCollection]
    public let cards: [ImportCardPayload]
}

public struct ImportCollectionBackupResult: Codable, Sendable {
    public let importedCount: Int
    public let updatedCount: Int
    public let skippedCount: Int
    public let collectionCount: Int

    private enum CodingKeys: String, CodingKey {
        case importedCount = "imported_count"
        case updatedCount = "updated_count"
        case skippedCount = "skipped_count"
        case collectionCount = "collection_count"
    }
}

public struct BinderPageCards: Sendable {
    public let cards: [CardWithPrice]
}

public struct CollectionBackupPreview: Codable, Sendable {
    public let newCollectionCount: Int
    public let updatedCollectionCount: Int
    public let newCardCount: Int
    public let updatedCardCount: Int
    public let movedCardCount: Int

    private enum CodingKeys: String, CodingKey {
        case newCollectionCount = "new_collection_count"
        case updatedCollectionCount = "updated_collection_count"
        case newCardCount = "new_card_count"
        case updatedCardCount = "updated_card_count"
        case movedCardCount = "moved_card_count"
    }
}
