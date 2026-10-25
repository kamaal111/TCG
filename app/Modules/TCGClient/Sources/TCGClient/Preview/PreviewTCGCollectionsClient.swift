import Foundation

actor PreviewTCGCollectionsClient: TCGCollectionsClient {
    private static let defaultBinderColumns = 3
    private static let defaultBinderRows = 3

    static let unfiledID = UUID(uuid: (0, 0, 0, 0, 0, 0, 64, 0, 128, 0, 0, 0, 0, 0, 0, 1))
    private var collections = [
        CardBinderCollection(
            id: unfiledID,
            name: "Unfiled",
            isUnfiled: true,
            columns: PreviewTCGCollectionsClient.defaultBinderColumns,
            rows: PreviewTCGCollectionsClient.defaultBinderRows,
            revision: 0,
            pages: []
        )
    ]

    func list() -> Result<[CardCollectionSummary], CollectionsError> { .success(collections.map(\.summary)) }

    func get(id: UUID) -> Result<CardBinderCollection, CollectionsError> {
        guard let collection = collections.first(where: { $0.id == id }) else { return .failure(.notFound) }
        return .success(collection)
    }

    func create(name: String) -> Result<CardBinderCollection, CollectionsError> {
        let collection = CardBinderCollection(
            id: UUID(),
            name: name,
            isUnfiled: false,
            columns: PreviewTCGCollectionsClient.defaultBinderColumns,
            rows: PreviewTCGCollectionsClient.defaultBinderRows,
            revision: 0,
            pages: []
        )
        collections.append(collection)
        return .success(collection)
    }

    func update(_ collection: CardBinderCollection) -> Result<CardBinderCollection, CollectionsError> {
        save(collection)
    }

    func save(_ collection: CardBinderCollection) -> Result<CardBinderCollection, CollectionsError> {
        guard let index = collections.firstIndex(where: { $0.id == collection.id }) else { return .failure(.notFound) }
        guard collection.revision == collections[index].revision else { return .failure(.conflict) }
        var updated = collection
        updated.revision += 1
        collections[index] = updated
        return .success(updated)
    }

    func delete(id: UUID) -> Result<Void, CollectionsError> {
        guard collections.contains(where: { $0.id == id && !$0.isUnfiled }) else { return .failure(.notFound) }
        collections.removeAll { $0.id == id }
        return .success(())
    }

    func page(collectionID: UUID, pageID: UUID) -> Result<BinderPageCards, CollectionsError> {
        guard collections.first(where: { $0.id == collectionID })?.pages.contains(where: { $0.id == pageID }) == true
        else { return .failure(.notFound) }
        return .success(.init(cards: []))
    }

    func export(ids: [UUID]?) -> Result<CollectionBackup, CollectionsError> {
        .success(
            .init(
                version: CollectionBackup.currentVersion,
                collections: collections.filter { ids?.contains($0.id) ?? true },
                cards: []
            )
        )
    }

    func preview(_ backup: CollectionBackup) -> Result<CollectionBackupPreview, CollectionsError> {
        .success(
            .init(
                newCollectionCount: backup.collections.count,
                updatedCollectionCount: 0,
                newCardCount: backup.cards.count,
                updatedCardCount: 0,
                movedCardCount: 0
            )
        )
    }

    func importBackup(_ backup: CollectionBackup) -> Result<ImportCollectionBackupResult, CollectionsError> {
        .failure(.unavailable)
    }
}
