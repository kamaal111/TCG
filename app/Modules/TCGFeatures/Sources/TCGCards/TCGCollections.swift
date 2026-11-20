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
    private(set) var destination: CollectionDestination = .allCards
    var selectedID: UUID? { destination.namedID }
    private(set) var isWorking = false
    var error: CollectionsError?
    private let client: TCGCollectionsClient
    private var downloadedCollections: [UUID: CardBinderCollection]?
    private var downloadedCards: [UUID: CardWithPrice] = [:]
    private let preferences: CollectionPreferences
    private let logger = KamaalLogger(from: TCGCollections.self)
    private var account: String?
    private var generation = UUID()
    private var reloadRevision = 0
    private var readGeneration = UUID()
    private let summaryReads = SharedCollectionReads<Bool, Result<[CardCollectionSummary], CollectionsError>>()
    private let layoutReads = SharedCollectionReads<UUID, Result<CardBinderCollection, CollectionsError>>()
    private let pageReads = SharedCollectionReads<
        CollectionSnapshotCache.Scope, Result<BinderPageCards, CollectionsError>
    >()
    private var layouts: [UUID: CardBinderCollection] = [:]
    private(set) var binderRefreshID = UUID()
    private(set) var binderForegroundID = UUID()
    private weak var presentationCards: TCGCards?
    private var views: [UUID: CollectionViewMode] = [:]
    private(set) var cardFormCollectionID: UUID?

    public init(client: TCGClient, defaults: UserDefaults?) {
        self.client = client.collections
        preferences = CollectionPreferences(defaults: defaults)
    }

    private(set) var selected: CardBinderCollection?
    var unfiled: CardCollectionSummary? { collections.first(where: \.isUnfiled) }
    var namedCollections: [CardCollectionSummary] {
        collections.filter { downloadedCollections != nil || !$0.isUnfiled }
    }

    func useDownload(cards: [CardWithPrice], collections: [CardBinderCollection]) {
        downloadedCollections = Dictionary(collections.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        downloadedCards = Dictionary(cards.map { ($0.card.id, $0) }, uniquingKeysWith: { first, _ in first })
        self.collections = collections.map(\.summary)
    }

    func view(for collectionID: UUID) -> CollectionViewMode {
        views[collectionID]
            ?? account.flatMap { preferences.restoreView(account: $0, collectionID: collectionID) }
            ?? .list
    }

    func setView(_ view: CollectionViewMode, for collectionID: UUID) {
        views[collectionID] = view
        if selectedID == collectionID { presentationCards?.isShowingBinder = view == .binder }
        if let account { preferences.saveView(view, account: account, collectionID: collectionID) }
    }

    public func trackSession(
        _ auth: KamaalAuth,
        cards: TCGCards,
        offlineSeed: (String) -> (cards: [CardWithPrice], collections: [CardBinderCollection])
    ) async {
        error = nil
        var reloadTask: Task<Void, Never>?
        defer { reloadTask?.cancel() }

        for await state in auth.sessionStates() {
            guard !Task.isCancelled else { return }
            switch state {
            case .validatingCredentials: break
            case .unauthenticated:
                reloadTask?.cancel()
                clearSession()
                cards.useAccount(nil)
                cards.clearCollectionSelection()
            case .authenticated:
                guard let id = auth.session?.email else { continue }
                if account != id { startSession(account: id, cards: cards, seed: offlineSeed(id)) }
                reloadTask?.cancel()
                reloadTask = Task { await reload(using: cards, force: false, loadsList: true) }
            }
        }
    }

    func startSession(
        account: String,
        cards: TCGCards,
        seed: (cards: [CardWithPrice], collections: [CardBinderCollection])
    ) {
        clearSession()
        self.account = account
        cards.useAccount(account)
        cards.seedOnlineCollection(seed.cards)
        collections = cards.snapshot.summaries
        if collections.isEmpty { collections = seed.collections.map(\.summary) }

        destination = preferences.restoreDestination(account: account)
        if let selectedID {
            if let cached = cards.snapshot.selected, cached.id == selectedID {
                selected = cached
            } else {
                selected = seed.collections.first { $0.id == selectedID }
            }
            layouts[selectedID] = selected
            cardFormCollectionID = selectedID
            cards.isShowingBinder = view(for: selectedID) == .binder
        }
        cards.restoreCollection(selected)
    }

    public func hasRestoredDestination(for account: String) -> Bool {
        self.account == account
    }

    public func stopLiveLoading(using cards: TCGCards) {
        clearSession()
        cards.onCollectionNotFound = nil
        cards.onCollectionMutation = nil
        cards.useAccount(nil)
        cards.clearCollectionSelection()
    }

    func clearSession() {
        generation = UUID()
        clearReads()
        layouts.removeAll()
        account = nil
        destination = .allCards
        cardFormCollectionID = nil
        selected = nil
        collections = []
        views = [:]
        error = nil
        isWorking = false
    }

    private func clearReads() {
        readGeneration = UUID()
        summaryReads.clear()
        layoutReads.clear()
        pageReads.clear()
    }

    func reload(using cards: TCGCards, force: Bool, loadsList: Bool) async {
        guard downloadedCollections == nil, !Task.isCancelled else { return }

        presentationCards = cards
        cards.onCollectionNotFound = { [weak self, weak cards] id in
            guard let self, let cards else { return }

            await collectionDisappeared(id, using: cards)
        }
        cards.onCollectionMutation = { [weak self, weak cards] in
            guard let self else { return }
            guard let cards else { return }
            self.clearReads()
            if cards.isShowingBinder {
                await self.refresh(using: cards, force: true)
            } else {
                await self.reload(using: cards, force: true, loadsList: true)
            }
        }
        if !force, cards.snapshot.summariesAreFresh(at: cards.now()) {
            guard let selectedID else { return }

            if let summary = namedCollections.first(where: { $0.id == selectedID }) {
                if selected?.revision != summary.revision {
                    await applySelection(summary, using: cards, loadsList: loadsList)
                }
                return
            }
        }

        let token = generation
        reloadRevision += 1
        let revision = reloadRevision
        let result = await summaryReads.read(true) { [client] in await client.list() }
        switch result {
        case .success(let result):
            guard generation == token, !Task.isCancelled else { return }
            guard reloadRevision == revision else { return }
            collections = result
            cards.snapshot.saveSummaries(result, checkedAt: cards.now())
            let currentIDs = Set(result.map(\.id))
            views = views.filter { currentIDs.contains($0.key) }
            layouts = layouts.filter { currentIDs.contains($0.key) }
            if let cardFormCollectionID, !currentIDs.contains(cardFormCollectionID) {
                self.cardFormCollectionID = nil
            }
            let selection = result.first { $0.id == selectedID && !$0.isUnfiled }
            if let selectedID, selection == nil {
                await collectionDisappeared(selectedID, using: cards)
            } else {
                await applySelection(selection, using: cards, loadsList: loadsList)
            }
        case .failure(let failure):
            guard generation == token, !Task.isCancelled else { return }
            guard reloadRevision == revision else { return }
            error = failure
        }
    }

    func select(_ destination: CollectionDestination, using cards: TCGCards, loadsList: Bool) async {
        guard !Task.isCancelled else { return }

        switch destination {
        case .system:
            if destination == .allCards { cardFormCollectionID = nil }
            setDestination(destination)
            await applySelection(nil, using: cards, loadsList: loadsList && destination == .allCards)
        case .named(let id):
            guard let summary = collections.first(where: { $0.id == id }) else { return }

            cardFormCollectionID = id
            setDestination(destination)
            await applySelection(summary, using: cards, loadsList: loadsList)
        }
    }

    private func setDestination(_ destination: CollectionDestination) {
        self.destination = destination
        if let account { preferences.saveDestination(destination, account: account) }
    }

    private func applySelection(_ summary: CardCollectionSummary?, using cards: TCGCards, loadsList: Bool) async {
        presentationCards = cards
        guard let summary else {
            cards.isShowingBinder = false
            selected = nil
            cards.snapshot.saveCollections(collections, selected: nil)
            await cards.selectCollection(nil, loadsList: loadsList)
            return
        }
        let id = summary.id
        cards.isShowingBinder = view(for: id) == .binder
        if let downloadedCollections {
            selected = downloadedCollections[id]
            await cards.selectCollection(selected, loadsList: loadsList && !cards.isShowingBinder)
            return
        }
        let cached = selected?.id == id ? selected : layouts[id]
        if let cached, cached.revision == summary.revision {
            selected = cached
            cards.snapshot.saveCollections(collections, selected: cached)
            await cards.selectCollection(cached, loadsList: loadsList && !cards.isShowingBinder)
            return
        }
        if selected?.id != summary.id { selected = nil }
        let token = readGeneration
        let result = await layoutReads.read(id) { [client] in await client.get(id: id) }
        switch result {
        case .success(let collection):
            guard readGeneration == token, !Task.isCancelled else { return }
            guard selectedID == summary.id else { return }
            guard let latest = collections.first(where: { $0.id == collection.id }) else { return }
            guard collection.revision >= latest.revision else { return }
            replace(collection)
            cards.snapshot.saveCollections(collections, selected: collection)
            await cards.selectCollection(collection, loadsList: loadsList && !cards.isShowingBinder)
        case .failure(let failure):
            guard readGeneration == token, !Task.isCancelled else { return }
            guard selectedID == summary.id else { return }
            if failure == .collectionNotFound {
                await collectionDisappeared(summary.id, using: cards)
            } else {
                error = failure
            }
        }
    }

    func collectionDisappeared(_ id: UUID, using cards: TCGCards) async {
        guard selectedID == id else { return }

        collections.removeAll { $0.id == id }
        views.removeValue(forKey: id)
        layouts.removeValue(forKey: id)
        cards.snapshot.removeCollection(id)
        await select(.allCards, using: cards, loadsList: true)
    }

    public func refreshOnForeground(using cards: TCGCards) async {
        guard account != nil else { return }

        await refresh(using: cards, force: false)
    }

    func create(name: String, using cards: TCGCards) async -> Bool {
        guard !isWorking else { return false }
        let token = generation
        let result = await create(name: name)
        guard generation == token else { return false }
        switch result {
        case .success(let collection):
            cards.invalidateCollectionReads()
            clearReads()
            selected = collection
            await select(.named(collection.id), using: cards, loadsList: true)
            guard generation == token else { return false }
            await reload(using: cards, force: true, loadsList: false)
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
        await save(SaveBinderLayoutPayload(collection: collection, moveFromUnfiledCardID: nil), using: cards)
    }

    func save(_ payload: SaveBinderLayoutPayload, using cards: TCGCards) async -> Bool {
        let saved = await perform(using: cards, action: { await client.save(payload) }, apply: replace)
        if saved, payload.moveFromUnfiledCardID != nil, cards.selectedCollection?.id == payload.collection.id {
            await cards.refresh(force: true)
        }
        return saved
    }

    func delete(_ collection: CardBinderCollection, using cards: TCGCards) async -> Bool {
        await perform(using: cards, action: { await client.delete(id: collection.id) }, apply: { _ in })
    }

    private func replace(_ collection: CardBinderCollection) {
        layouts[collection.id] = collection
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
            cards.invalidateCollectionReads()
            clearReads()
            await refresh(using: cards, force: true)
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

    func refresh(using cards: TCGCards, force: Bool) async {
        let previous = destination
        let revision = selected?.revision
        let token = generation
        await reload(using: cards, force: force, loadsList: false)
        guard generation == token, !Task.isCancelled else { return }
        guard destination == previous else { return }

        if cards.isShowingBinder {
            guard selected?.revision == revision else { return }

            if force {
                binderRefreshID = UUID()
            } else {
                binderForegroundID = UUID()
            }
        } else {
            await cards.refresh(force: force)
        }
    }

    func page(_ pageID: UUID, using cards: TCGCards, force: Bool) async -> Result<
        BinderPageCards, CollectionsError
    > {
        if downloadedCollections != nil {
            guard let page = selected?.pages.first(where: { $0.id == pageID }) else { return .failure(.notFound) }
            let ids = Set(page.slots.map(\.cardID))
            return .success(BinderPageCards(cards: ids.compactMap { downloadedCards[$0] }))
        }
        guard let selectedID, let selected else { return .failure(.notFound) }

        let scope = CollectionSnapshotCache.Scope(collectionID: selectedID, pageID: pageID, revision: selected.revision)
        if !force, let fresh = cards.snapshot.freshPage(for: scope, at: cards.now(), force: false) {
            return .success(BinderPageCards(cards: fresh.cards.map(cards.compatibleDisplay)))
        }

        let token = readGeneration
        let result = await pageReads.read(scope) { [client] in
            await client.page(collectionID: selectedID, pageID: pageID)
        }
        guard token == readGeneration, !Task.isCancelled else { return .failure(.unauthorized) }
        guard self.selectedID == selectedID, self.selected?.revision == selected.revision else {
            return .failure(.notFound)
        }

        if case .success(let page) = result {
            let checkedAt = cards.now()
            cards.snapshot.verify(page.cards, at: checkedAt, updating: scope)
            let cached = cards.snapshot.rows(for: scope) ?? []
            let byID = Dictionary(cached.map { ($0.card.id, $0) }, uniquingKeysWith: { first, _ in first })
            let merged = page.cards.map { cards.keepingPrice(for: $0, cached: byID[$0.card.id]) }
            cards.snapshot.saveRead(merged, for: scope, checkedAt: checkedAt, list: nil)
        }
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
            cards.invalidateCollectionReads()
            clearReads()
            await refresh(using: cards, force: true)
        }
        return result
    }
}

extension EnvironmentValues {
    @Entry public var tcgCollections: TCGCollections? = nil
    @Entry var isEditingCollection = false
}
