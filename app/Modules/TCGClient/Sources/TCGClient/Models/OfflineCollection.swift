import Foundation

public struct OfflineCollectionEntry: Codable, Hashable, Sendable {
    public enum Kind: String, Codable, Sendable {
        case card, collection
    }

    public let kind: Kind
    public let id: UUID
    public let hash: String

    init(_ entry: Components.Schemas.OfflineCollectionEntry) throws {
        guard let kind = Kind(rawValue: entry.kind.rawValue) else {
            throw OfflineCollectionError.invalidResponse
        }
        self.kind = kind
        id = try Self.decodeID(entry.id)
        hash = entry.hash
    }

    static func decodeID(_ value: String) throws -> UUID {
        try UUIDCoding.decode(value).mapError { _ in OfflineCollectionError.invalidResponse }.get()
    }
}

public struct OfflineCollectionManifest: Sendable {
    public let etag: String
    public let accountID: String
    public let entries: [OfflineCollectionEntry]
    public let needsPreparation: [UUID]
}

public struct OfflineCollectionRecords: Sendable {
    public let cards: [CardWithPrice]
    public let collections: [CardBinderCollection]
}
