import Foundation

public enum OfflineCollectionError: Error, Equatable {
    case unauthorized
    case changed
    case invalidResponse
}

public struct TCGOfflineCollectionClient: Sendable {
    private let client: Client

    init(client: Client) {
        self.client = client
    }

    public func manifest(etag: String?) async throws -> OfflineCollectionManifest? {
        switch try await client.getOfflineCollectionManifest(headers: .init(ifNoneMatch: etag)) {
        case .ok(let response):
            let manifest = try response.body.json
            let needsPreparation = try manifest.needsPreparation.map(OfflineCollectionEntry.decodeID)
            return try OfflineCollectionManifest(
                etag: response.headers.eTag,
                accountID: manifest.accountId,
                entries: manifest.entries.map(OfflineCollectionEntry.init),
                needsPreparation: needsPreparation
            )
        case .notModified:
            return nil
        case .unauthorized:
            throw OfflineCollectionError.unauthorized
        case .undocumented:
            throw OfflineCollectionError.invalidResponse
        }
    }

    public func records(_ entries: [OfflineCollectionEntry]) async throws -> OfflineCollectionRecords {
        let requested = try entries.map { entry in
            guard let kind = Components.Schemas.OfflineCollectionEntry.KindPayload(rawValue: entry.kind.rawValue) else {
                throw OfflineCollectionError.invalidResponse
            }
            return Components.Schemas.OfflineCollectionEntry(
                kind: kind,
                id: UUIDCoding.encode(entry.id),
                hash: entry.hash
            )
        }
        switch try await client.getOfflineCollectionRecords(body: .json(.init(entries: requested))) {
        case .ok(let response):
            let records = try response.body.json
            return try OfflineCollectionRecords(
                cards: records.cards.map { try TCGCardsClientImpl.makeCardWithPrice($0).get() },
                collections: records.collections.map { try CollectionMapper.makeCollection($0).get() }
            )
        case .unauthorized:
            throw OfflineCollectionError.unauthorized
        case .conflict:
            throw OfflineCollectionError.changed
        case .badRequest, .undocumented:
            throw OfflineCollectionError.invalidResponse
        }
    }

    public func prepare(_ ids: [UUID]) async throws -> Set<UUID> {
        switch try await client.prepareOfflineCollectionCards(body: .json(.init(cardIds: ids.map(UUIDCoding.encode)))) {
        case .ok(let response):
            return try Set(response.body.json.retryCardIds.map(OfflineCollectionEntry.decodeID))
        case .unauthorized:
            throw OfflineCollectionError.unauthorized
        case .badRequest, .undocumented:
            throw OfflineCollectionError.invalidResponse
        }
    }

}
