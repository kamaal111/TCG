import Foundation
import KamaalAuth
import KamaalLogger
import Observation
import SwiftUI
import TCGClient

@MainActor
@Observable
public final class TCGCollections {
    private(set) var collections: [CardCollectionSummary] = []
    private(set) var selectedID: UUID?
    private(set) var isWorking = false
    var error: CollectionsError?
    private let client: TCGCollectionsClient
    private let preferences: CollectionPreferences
    private let logger = KamaalLogger(from: TCGCollections.self)
    private var account: String?
    private var generation = UUID()
    private var reloadRevision = 0
    private var views: [UUID: CollectionViewMode] = [:]

    public init(client: TCGClient, defaults: UserDefaults?) {
        self.client = client.collections
        preferences = CollectionPreferences(defaults: defaults)
    }

    private(set) var selected: CardBinderCollection?
    var unfiled: CardCollectionSummary? { collections.first(where: \.isUnfiled) }
    var namedCollections: [CardCollectionSummary] { collections.filter { !$0.isUnfiled } }

    func view(for collectionID: UUID) -> CollectionViewMode {
        views[collectionID]
            ?? account.flatMap { preferences.restoreView(account: $0, collectionID: collectionID) }
            ?? .list
    }

    func setView(_ view: CollectionViewMode, for collectionID: UUID) {
        views[collectionID] = view
        if let account { preferences.saveView(view, account: account, collectionID: collectionID) }
    }

    public func trackSession(_ auth: KamaalAuth, cards: TCGCards) async {
        for await state in auth.sessionStates() {
            guard !Task.isCancelled else { return }
            switch state {
            case .validatingCredentials: break
            case .unauthenticated:
                clearSession()
                cards.clearCollectionSelection()
            case .authenticated:
                guard let id = auth.session?.email else { continue }
                if account != id {
                    clearSession()
                    account = id
                }
                await reload(using: cards)
            }
        }
    }

    func clearSession() {
        generation = UUID()
        account = nil
        selectedID = nil
        selected = nil
        collections = []
        views = [:]
        error = nil
        isWorking = false
    }

    func reload(using cards: TCGCards) async {
        cards.onCollectionMutation = { [weak self, weak cards] in
            guard let self else { return }
            guard let cards else { return }
            await self.reload(using: cards)
        }
        let token = generation
        reloadRevision += 1
        let revision = reloadRevision
        switch await client.list() {
        case .success(let result):
            guard generation == token else { return }
            guard reloadRevision == revision else { return }
            collections = result
            let currentIDs = Set(result.map(\.id))
            views = views.filter { currentIDs.contains($0.key) }
            let previous = selectedID ?? account.flatMap { preferences.restore(account: $0) }
            let selection = result.first { $0.id == previous && !$0.isUnfiled }
            await select(selection?.id, using: cards)
        case .failure(let failure):
            guard generation == token else { return }
            guard reloadRevision == revision else { return }
            error = failure
        }
    }

    func select(_ id: UUID?, using cards: TCGCards) async {
        guard let id else {
            selectedID = nil
            selected = nil
            if let account { preferences.save(nil, account: account) }
            await cards.selectCollection(nil)
            return
        }
        guard let summary = collections.first(where: { $0.id == id }) else { return }
        selectedID = summary.id
        if let account { preferences.save(summary.id, account: account) }
        if let selected, selected.id == summary.id, selected.revision == summary.revision {
            await cards.selectCollection(selected)
            return
        }
        selected = nil
        let token = generation
        switch await client.get(id: summary.id) {
        case .success(let collection):
            guard generation == token else { return }
            guard selectedID == summary.id else { return }
            guard let latest = collections.first(where: { $0.id == collection.id }) else { return }
            guard collection.revision >= latest.revision else { return }
            replace(collection)
            await cards.selectCollection(collection)
        case .failure(let failure):
            guard generation == token else { return }
            guard selectedID == summary.id else { return }
            error = failure
        }
    }

    func create(name: String, using cards: TCGCards) async -> Bool {
        guard !isWorking else { return false }
        let token = generation
        let result = await create(name: name)
        guard generation == token else { return false }
        switch result {
        case .success(let collection):
            selected = collection
            selectedID = collection.id
            await reload(using: cards)
            return true
        case .failure(let failure):
            error = failure
            return false
        }
    }

    func create(name: String) async -> Result<CardBinderCollection, CollectionsError> {
        await mutate(
            action: { await client.create(name: name.trimmingCharacters(in: .whitespacesAndNewlines)) },
            apply: { collections.append($0.summary) }
        )
    }

    func update(_ collection: CardBinderCollection, using cards: TCGCards) async -> Bool {
        await perform(using: cards, action: { await client.update(collection) }, apply: replace)
    }

    func save(_ collection: CardBinderCollection, using cards: TCGCards) async -> Bool {
        await perform(using: cards, action: { await client.save(collection) }, apply: replace)
    }

    func delete(_ collection: CardBinderCollection, using cards: TCGCards) async -> Bool {
        await perform(using: cards, action: { await client.delete(id: collection.id) }, apply: { _ in })
    }

    private func replace(_ collection: CardBinderCollection) {
        collections = collections.map { $0.id == collection.id ? collection.summary : $0 }
        if selectedID == collection.id { selected = collection }
    }

    private func perform<Value>(
        using cards: TCGCards,
        action: () async -> Result<Value, CollectionsError>,
        apply: (Value) -> Void
    ) async -> Bool {
        guard !isWorking else { return false }
        let token = generation
        let result = await mutate(action: action, apply: apply)
        guard generation == token else { return false }
        switch result {
        case .success:
            await reload(using: cards)
            return true
        case .failure(let failure):
            error = failure
            return false
        }
    }

    private func mutate<Value>(
        action: () async -> Result<Value, CollectionsError>,
        apply: (Value) -> Void
    ) async -> Result<Value, CollectionsError> {
        guard !isWorking else { return .failure(.busy) }
        let token = generation
        isWorking = true
        error = nil
        let result = await action()
        guard token == generation else { return .failure(.unauthorized) }
        isWorking = false
        switch result {
        case .success(let value):
            apply(value)
            logger.info("event=collections.mutation.completed")
        case .failure:
            logger.warning("event=collections.mutation.failed")
        }
        return result
    }

    func refresh(using cards: TCGCards) async {
        let previous = cards.selectedCollection?.id
        let token = generation
        await reload(using: cards)
        guard generation == token else { return }
        guard cards.selectedCollection?.id == previous else { return }
        await cards.refresh()
    }

    func page(_ pageID: UUID) async -> Result<BinderPageCards, CollectionsError> {
        guard let selectedID else { return .failure(.notFound) }
        let token = generation
        let result = await client.page(collectionID: selectedID, pageID: pageID)
        guard token == generation else { return .failure(.unauthorized) }
        guard self.selectedID == selectedID else { return .failure(.notFound) }
        return result
    }

    func export(ids: [UUID]?) async -> Result<CollectionBackup, CollectionsError> {
        let token = generation
        let result = await client.export(ids: ids)
        guard token == generation else { return .failure(.unauthorized) }
        return result
    }

    func preview(_ backup: CollectionBackup) async -> Result<CollectionBackupPreview, CollectionsError> {
        let token = generation
        let result = await client.preview(backup)
        guard token == generation else { return .failure(.unauthorized) }
        return result
    }

    func importBackup(_ backup: CollectionBackup, using cards: TCGCards) async -> Result<
        ImportCollectionBackupResult, CollectionsError
    > {
        let token = generation
        let result = await client.importBackup(backup)
        guard token == generation else { return .failure(.unauthorized) }
        if case .success = result {
            await refresh(using: cards)
        }
        return result
    }
}

extension EnvironmentValues {
    @Entry public var tcgCollections: TCGCollections? = nil
    @Entry var isEditingCollection = false
}
