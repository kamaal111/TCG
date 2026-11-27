//
//  TCGCards.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/20/26.
//

import Foundation
import KamaalExtensions
import KamaalLogger
import Observation
import TCGClient
import TCGCurrency
import TCGListSupport

@MainActor
@Observable
public final class TCGCards {
    private(set) var cards: [CardWithPrice] = []
    private(set) var availableIllustrators: Set<String> = []
    private(set) var availableSetNames: Set<String> = []
    private(set) var isLoadingNextPage = false
    private(set) var nextPageError: TCGCardsOperationError?
    private(set) var displayRefreshError: TCGCardsOperationError?

    let snapshot: CollectionSnapshotCache
    let now: () -> Date
    private let pricing: CollectionPricing
    private let listReads = SharedCollectionReads<ListCardsQuery, Result<CardCollectionPage, ListCardsErrors>>()
    private let detailReads = SharedCollectionReads<UUID, Result<CardWithPrice, OwnedCardReadError>>()
    public private(set) var collectionRevision = 0
    private(set) var deletedCardIDs: Set<UUID> = []
    private(set) var isLoadingPrices = false
    private var priceTasks: [UUID: Task<Void, Never>] = [:]
    private var loadingPriceTasks: Set<UUID> = []
    private var accountGeneration = UUID()
    private var account: String?
    private var offlineSeed: [CardWithPrice] = []
    var onCollectionNotFound: (@MainActor (UUID) async -> Void)?

    var isShowingBinder = false
    var allocationAdjustments = 0
    var onCollectionMutation: (@MainActor () async -> Void)?
    private(set) var selectedCollection: CardBinderCollection?
    private let client: TCGClient
    private let logger: KamaalLogger
    private var downloadedCards: [CardWithPrice]?
    var isReadOnly: Bool { downloadedCards != nil }
    private var collectionState = CollectionState(illustrators: [])
    private var displayIdentity: TCGCurrency.DisplayIdentity?

    var isLoading: Bool { collectionState.status == .loading }
    var hasMoreCards: Bool { collectionState.nextCursor != nil }

    var hasLoadedCurrentCollection: Bool { collectionState.status == .loaded }

    convenience init(client: TCGClient) {
        self.init(
            client: client,
            snapshot: CollectionSnapshotCache(root: CollectionSnapshotCache.defaultRoot),
            now: { .now }
        )
    }

    convenience init(client: TCGClient, snapshot: CollectionSnapshotCache, now: @escaping () -> Date) {
        self.init(client: client, snapshot: snapshot, now: now, logger: KamaalLogger(from: TCGCards.self))
    }

    init(client: TCGClient, snapshot: CollectionSnapshotCache, now: @escaping () -> Date, logger: KamaalLogger) {
        self.client = client
        self.logger = logger
        self.snapshot = snapshot
        self.now = now
        pricing = CollectionPricing(client: client.cards, snapshot: snapshot, now: now)
    }

    public static func `default`() -> TCGCards { TCGCards(client: .default()) }

    public static func hasStartupCache(for account: String) -> Bool {
        CollectionSnapshotCache(root: CollectionSnapshotCache.defaultRoot).containsSnapshot(for: account)
    }

    public static func startupCache(for account: String) async
        -> (cards: [CardWithPrice], collections: [CardBinderCollection])?
    {
        await CollectionSnapshotCache(root: CollectionSnapshotCache.defaultRoot).startupRows(for: account)
    }

    func useAccount(_ account: String?) {
        guard self.account != account else { return }

        self.account = account
        accountGeneration = UUID()
        pricing.clear()
        listReads.clear()
        detailReads.clear()
        offlineSeed = []
        deletedCardIDs = []
        clearCollectionSelection()
        collectionState = CollectionState(illustrators: [], generation: collectionState.generation)
        availableSetNames = []
        availableIllustrators = []
        snapshot.useAccount(account)
    }

    func seedOnlineCollection(_ rows: [CardWithPrice]) {
        offlineSeed = rows
    }

    func cachedBinderRows(for scope: CollectionSnapshotCache.Scope, cardIDs: Set<UUID>) -> [CardWithPrice] {
        var previous = scope
        previous.revision = nil
        let cached = snapshot.rows(for: scope) ?? snapshot.rows(for: previous) ?? offlineSeed
        return cached.filter { cardIDs.contains($0.card.id) }.map(compatibleDisplay)
    }

    private var scope: CollectionSnapshotCache.Scope {
        .init(
            collectionID: selectedCollection?.id,
            game: collectionState.game,
            sets: collectionState.setNames.sorted(),
            illustrators: collectionState.illustrators.map { $0.lowercased() }.sorted(),
            query: collectionState.query?.trimmingByWhitespacesAndNewLines
        )
    }

    func compatibleDisplay(_ entry: CardWithPrice) -> CardWithPrice {
        let cachedCurrency = entry.card.displayCurrency ?? entry.price?.price?.display?.preferredCurrency
        guard let displayIdentity, cachedCurrency != displayIdentity.currency else { return entry }

        return .init(
            card: entry.card.replacingDisplay(with: nil),
            price: nil,
            imageURL: entry.imageURL
        )
    }

    func validateCard(_ entry: CardWithPrice) async -> Result<CardWithPrice, OwnedCardReadError> {
        guard !isReadOnly else { return .success(entry) }

        let id = entry.card.id
        if deletedCardIDs.contains(id) { return .failure(.notFound) }
        if let verified = snapshot.verifiedCard(id, at: now()), verified.card.updatedAt >= entry.card.updatedAt {
            return .success(keepingPrice(for: compatibleDisplay(verified), cached: compatibleDisplay(entry)))
        }

        let owner = accountGeneration
        let collectionID = selectedCollection?.id
        let result = await detailReads.read(id) { [client] in await client.cards.details(id: id) }
        guard accountGeneration == owner, selectedCollection?.id == collectionID, !Task.isCancelled else {
            return .failure(.unavailable)
        }

        switch result {
        case .success(let details):
            snapshot.verify([details], at: now(), updating: nil)
            return .success(keepingPrice(for: details, cached: compatibleDisplay(entry)))
        case .failure(.notFound):
            deletedCardIDs.insert(entry.card.id)
            snapshot.removeCard(entry.card.id)
            offlineSeed.removeAll { $0.card.id == entry.card.id }
            setCards(cards.filter { $0.card.id != entry.card.id })
            return .failure(.notFound)
        case .failure(let error): return .failure(error)
        }
    }

    func needsPriceRefresh(for rows: [CardWithPrice], currency: Currency?, retry: Bool) -> Bool {
        !isReadOnly && pricing.needsRefresh(rows, currency: currency ?? displayIdentity?.currency, retry: retry)
    }

    func refreshedPrices(
        for rows: [CardWithPrice],
        currency: Currency?,
        retry: Bool
    ) async -> [CardWithPrice] {
        guard !isReadOnly else { return rows }

        let identity = displayIdentity
        let refreshed = await pricing.refresh(rows, currency: currency ?? identity?.currency, retry: retry)
        return currency != nil || identity == displayIdentity ? refreshed : rows
    }

    func keepingPrice(for details: CardWithPrice, cached: CardWithPrice?) -> CardWithPrice {
        guard details.price == nil, let cached, cached.card.updatedAt == details.card.updatedAt,
            cached.card.displayCurrency == details.card.displayCurrency
        else { return details }

        return .init(
            card: details.card.replacingDisplay(with: cached.card),
            price: cached.price,
            imageURL: details.imageURL ?? cached.imageURL
        )
    }

    private func clearVisiblePricing() {
        for task in priceTasks.values { task.cancel() }
        priceTasks.removeAll()
        loadingPriceTasks.removeAll()
        isLoadingPrices = false
    }

    private func refreshVisiblePrices(ids: Set<UUID>?, retry: Bool) {
        let generation = collectionState.generation
        let rows = ids.map { selected in cards.filter { selected.contains($0.card.id) } } ?? cards
        guard !rows.isEmpty else { return }

        let request = UUID()
        if needsPriceRefresh(for: rows, currency: nil, retry: retry) {
            loadingPriceTasks.insert(request)
            isLoadingPrices = true
        }
        priceTasks[request] = Task { [weak self] in
            guard let self else { return }

            defer {
                priceTasks.removeValue(forKey: request)
                loadingPriceTasks.remove(request)
                isLoadingPrices = !loadingPriceTasks.isEmpty
            }
            let identity = displayIdentity
            let refreshed = await refreshedPrices(for: rows, currency: nil, retry: retry)
            guard generation == collectionState.generation, identity == displayIdentity, !Task.isCancelled else {
                return
            }

            let byID = Dictionary(refreshed.map { ($0.card.id, $0) }, uniquingKeysWith: { first, _ in first })
            let previous = cards
            setCards(
                previous.map { row in
                    guard let updated = byID[row.card.id], updated.card.updatedAt == row.card.updatedAt else {
                        return row
                    }
                    return updated
                }
            )
            if previous != cards { snapshot.save(cards, for: scope) }
        }
    }

    func useDownloadedCards(_ cards: [CardWithPrice]) {
        downloadedCards = cards
        invalidateDisplayPrices()
        setCards(cards)
    }

    func restoreCollection(_ collection: CardBinderCollection?) {
        selectedCollection = collection
        invalidateDisplayPrices()
        setCards((snapshot.rows(for: scope) ?? offlineSeed).map(compatibleDisplay))
    }

    func selectCollection(_ collection: CardBinderCollection?, loadsList: Bool) async {
        let changed = selectedCollection?.id != collection?.id
        selectedCollection = collection
        if changed || (loadsList && !hasLoadedCurrentCollection && !isLoading) {
            invalidateDisplayPrices()
            if loadsList { _ = await load(game: nil, setNames: [], query: nil, illustrators: []) }
        }
    }

    func clearCollectionSelection() {
        selectedCollection = nil
        isShowingBinder = false
        allocationAdjustments = 0
        invalidateDisplayPrices()
    }

    func cardPage(_ query: ListCardsQuery) async -> Result<CardCollectionPage, TCGCardsOperationError> {
        let identity = selectedCollection?.id
        let generation = collectionState.generation
        let result = await readListPage(query).mapError { _ in TCGCardsOperationError.serverUnavailable }
        guard selectedCollection?.id == identity else { return .failure(.serverUnavailable) }
        guard collectionState.generation == generation else { return .failure(.serverUnavailable) }
        return result
    }

    public func resetDisplayPrices() {
        displayIdentity = nil
        invalidateDisplayPrices()
        collectionState = CollectionState(illustrators: [], generation: collectionState.generation)
        availableSetNames = []
        availableIllustrators = []
    }

    public func refreshDisplayPrices(for identity: TCGCurrency.DisplayIdentity, refreshVisible: Bool) async {
        guard displayIdentity != identity else { return }
        let previous = displayIdentity
        displayIdentity = identity
        clearVisiblePricing()
        if previous != nil { setCards(cards.map(compatibleDisplay)) }
        if refreshVisible, !isShowingBinder { refreshVisiblePrices(ids: nil, retry: false) }
    }

    private func invalidateDisplayPrices() {
        clearVisiblePricing()
        collectionState.generation += 1
        collectionState.status = .idle
        collectionState.nextCursor = nil
        collectionState.visitedCursors = []
        cards = []
        isLoadingNextPage = false
        nextPageError = nil
        displayRefreshError = nil
    }

    func load(game: ClientCardGame?, setNames: Set<String>, query: String?, illustrators: Set<String>)
        async -> Result<
            Void, TCGCardsOperationError
        >
    {
        let pageCount =
            game == collectionState.game && setNames == collectionState.setNames && query == collectionState.query
                && illustrators == collectionState.illustrators
            ? max(1, collectionState.pageCount) : 1

        return await loadCollection(
            .init(game: game, setNames: setNames, query: query, pageCount: pageCount, illustrators: illustrators),
            force: false
        )
    }

    func loadNextPage() async -> Result<Void, TCGCardsOperationError> {
        guard collectionState.status == .loaded else { return .success(()) }
        guard !isLoadingNextPage else { return .success(()) }
        guard collectionState.nextCursor != nil else { return .success(()) }

        let generation = collectionState.generation
        isLoadingNextPage = true
        nextPageError = nil

        var pages = CardCollectionPages(
            cards: cards,
            pagination: .init(
                nextCursor: collectionState.nextCursor,
                visitedCursors: collectionState.visitedCursors,
                pageCount: collectionState.pageCount
            )
        )
        let existingIDs = Set(cards.map(\.card.id))
        let result = await loadPage(into: &pages, generation: generation)

        guard generation == collectionState.generation else { return .success(()) }

        isLoadingNextPage = false

        switch result {
        case .failure(let error):
            nextPageError = error
            return .failure(error)
        case .success(let didLoadPage):
            guard didLoadPage else { return .success(()) }

            let newIDs = Set(pages.cards.map(\.card.id)).subtracting(existingIDs)
            publish(pages, isFinal: true, checkedAt: nil, priceIDs: newIDs, retry: false)
            return .success(())
        }
    }

    private func loadCollection(
        _ request: CollectionRequest,
        force: Bool
    ) async -> Result<Void, TCGCardsOperationError> {
        let previousScope = scope
        clearVisiblePricing()
        if request.game != collectionState.game {
            availableSetNames = []
            availableIllustrators = []
        }
        collectionState = CollectionState(
            game: request.game,
            setNames: request.setNames,
            illustrators: request.illustrators,
            query: request.query,
            generation: collectionState.generation + 1,
            status: .loading,
            pageCount: request.pageCount
        )
        let generation = collectionState.generation
        isLoadingNextPage = false
        nextPageError = nil
        let cached =
            snapshot.rows(for: scope)
            ?? snapshot.rows(for: .init(collectionID: selectedCollection?.id))
            ?? (previousScope.collectionID == scope.collectionID && !cards.isEmpty ? cards : offlineSeed)
        setCards(cached.map(compatibleDisplay))

        if let downloadedCards {
            let scoped = downloadedCards.filter { entry in
                if let selectedCollection {
                    let collectionID = selectedCollection.isUnfiled ? nil : selectedCollection.id
                    guard entry.card.collectionID == collectionID else { return false }
                }
                return request.game == nil || entry.card.game == request.game
            }
            availableSetNames = Set(scoped.map(\.card.setName))
            availableIllustrators = Set(scoped.filter { $0.card.game == .pokemon }.compactMap(\.card.illustrator))
            let query = request.query?.trimmingByWhitespacesAndNewLines ?? ""
            setCards(query.isEmpty ? scoped : scoped.filter { $0.card.matchesSearch(query) })
            collectionState.status = .loaded
            logger.info(
                "collection.load.completed",
                fields: [
                    .init("source", "offline", privacy: .public),
                    .init("result_count", object: cards.count, privacy: .public),
                ]
            )
            return .success(())
        }

        if let fresh = snapshot.freshPage(for: scope, at: now(), force: force), let list = fresh.list {
            setCards(fresh.cards.map(compatibleDisplay))
            availableSetNames = list.sets
            availableIllustrators = list.illustrators
            collectionState.nextCursor = list.nextCursor
            collectionState.visitedCursors = list.visitedCursors
            collectionState.pageCount = list.pageCount
            collectionState.status = .loaded
            if list.requiresPricing != false { refreshVisiblePrices(ids: nil, retry: false) }
            logger.info(
                "collection.load.completed",
                fields: [
                    .init("source", "cache", privacy: .public),
                    .init("result_count", object: cards.count, privacy: .public),
                ]
            )
            return .success(())
        }

        var retainedSource = "cache"
        let result = await CachedListLoad.load(
            CardCollectionPages(cards: [], pagination: .init(nextCursor: nil, visitedCursors: [], pageCount: 0)),
            through: request.pageCount,
            pagination: \.pagination,
            fetch: { pages in await self.loadPage(into: &pages, generation: generation) },
            publish: { pages, isFinal in
                guard generation == self.collectionState.generation, !Task.isCancelled else { return }
                retainedSource = "network"
                self.publish(
                    pages,
                    isFinal: isFinal,
                    checkedAt: pages.pageCount == 1 ? self.now() : nil,
                    priceIDs: nil,
                    retry: force
                )
            }
        )
        guard generation == collectionState.generation else { return .success(()) }
        if collectionState.status == .loading { collectionState.status = .idle }
        if !Task.isCancelled {
            switch result {
            case .success where collectionState.status == .loaded:
                logger.info(
                    "collection.load.completed",
                    fields: [
                        .init("source", "network", privacy: .public),
                        .init("result_count", object: cards.count, privacy: .public),
                    ]
                )
            case .failure where !cards.isEmpty:
                logger.warning(
                    "collection.load.retained",
                    fields: [
                        .init("source", retainedSource, privacy: .public),
                        .init("result_count", object: cards.count, privacy: .public),
                    ]
                )
            default: break
            }
        }
        return result
    }

    private func loadPage(into pages: inout CardCollectionPages, generation: Int) async -> Result<
        Bool, TCGCardsOperationError
    > {
        guard generation == collectionState.generation else { return .success(false) }
        guard !Task.isCancelled else { return .success(false) }

        let result = await readListPage(
            .init(
                game: collectionState.game,
                setNames: collectionState.setNames,
                cursor: pages.nextCursor,
                collectionID: selectedCollection?.id,
                query: collectionState.query,
                illustrators: collectionState.illustrators
            )
        )

        guard generation == collectionState.generation else { return .success(false) }
        guard !Task.isCancelled else { return .success(false) }

        switch result {
        case .failure(.collectionNotFound):
            if let id = selectedCollection?.id { await onCollectionNotFound?(id) }
            return .success(false)
        case .failure:
            logger.error("Couldn't load the card collection.")
            return .failure(.serverUnavailable)
        case .success(let page):
            guard pages.append(page) else {
                logger.error("The collection page returned an invalid pagination cursor.")
                return .failure(.serverUnavailable)
            }

            snapshot.verify(page.cards, at: now(), updating: scope)
            return .success(true)
        }
    }

    private func readListPage(_ query: ListCardsQuery) async -> Result<CardCollectionPage, ListCardsErrors> {
        await listReads.read(query) { [client] in await client.cards.listPage(query) }
    }

    private func publish(
        _ pages: CardCollectionPages,
        isFinal: Bool,
        checkedAt: Date?,
        priceIDs: Set<UUID>?,
        retry: Bool
    ) {
        let cached = Dictionary(cards.map { ($0.card.id, $0) }, uniquingKeysWith: { first, _ in first })
        setCards(
            pages.cards.map { details in
                keepingPrice(for: details, cached: cached[details.card.id])
            }
        )
        let requiresPricing =
            pages.cards.contains { $0.price == nil }
            || priceIDs != nil && snapshot.freshPage(for: scope, at: now(), force: false)?.list?.requiresPricing == true
        snapshot.saveRead(
            cards,
            for: scope,
            checkedAt: checkedAt,
            list: .init(
                nextCursor: pages.nextCursor,
                visitedCursors: pages.visitedCursors,
                pageCount: pages.pageCount,
                sets: pages.availableSetNames,
                illustrators: pages.availableIllustrators,
                requiresPricing: requiresPricing
            )
        )
        if requiresPricing {
            refreshVisiblePrices(ids: priceIDs, retry: retry)
        }
        availableSetNames = pages.availableSetNames
        availableIllustrators = pages.availableIllustrators
        collectionState.nextCursor = pages.nextCursor
        collectionState.visitedCursors = pages.visitedCursors
        collectionState.pageCount = pages.pageCount
        collectionState.status = isFinal ? .loaded : .loading
    }

    func catalogSearch(game: ClientCardGame, name: String, cardNumber: String, cursor: String?) async -> Result<
        CardSearchResult, SearchPricingErrors
    > {
        await client.pricing.search(
            .init(game: game, query: "\(name) \(cardNumber)", languages: [], mode: .card, cursor: cursor)
        )
    }

    func purchaseDefault(cardID: UUID) async -> PricedCard? {
        let result = await client.cards.prices(ids: [cardID])
        return try? result.get().first { $0.cardID == cardID }?.price.price
    }

    func addCard(_ payload: CreateCardPayload) async -> Result<Void, TCGCardsOperationError> {
        let identity = displayIdentity
        let result = await client.cards.create(with: payload)
            .map { card in if displayIdentity == identity { insertCard(card) } }
            .mapError(mapCreateError)
        logMutation(.create, result: result)
        if case .success = result {
            invalidateCollectionReads()
            await refresh(force: true)
            await onCollectionMutation?()
        }
        return result
    }

    func updateCard(id: UUID, values: CardFormValues) async -> Result<CardWithPrice, TCGCardsOperationError> {
        await updateCard(id: id, payload: values.payload, operation: .update)
    }

    func moveCard(_ card: Card, to collectionID: UUID) async -> Result<CardWithPrice, TCGCardsOperationError> {
        let payload = UpdateCardPayload(
            notes: card.notes,
            purchases: card.purchases,
            collectionID: collectionID
        )
        return await updateCard(id: card.id, payload: payload, operation: .move)
    }

    private func updateCard(
        id: UUID,
        payload: UpdateCardPayload,
        operation: Mutation
    ) async -> Result<CardWithPrice, TCGCardsOperationError> {
        let identity = displayIdentity
        let result = await client.cards.update(id: id, with: payload)
            .map { card in
                if displayIdentity == identity {
                    replaceCard(card, id: id)
                    allocationAdjustments = card.card.allocationAdjustments ?? 0
                }
                return card
            }
            .mapError(mapUpdateError)
        logMutation(operation, result: result)
        if case .success = result {
            invalidateCollectionReads()
            await refresh(force: true)
            await onCollectionMutation?()
        }
        return result
    }

    func deleteCard(id: UUID) async -> Result<Void, TCGCardsOperationError> {
        await performDeletion(ids: [id])
            .flatMap { result in
                result.deletedIDs.contains(id) ? .success(()) : .failure(.notFound)
            }
    }

    func deleteCards(ids: [UUID]) async -> [TCGCardsOperationError] {
        switch await performDeletion(ids: ids) {
        case .success(let result): result.notFoundIDs.map { _ in .notFound }
        case .failure(let error): [error]
        }
    }

    private func performDeletion(ids: [UUID]) async -> Result<DeleteCardsResult, TCGCardsOperationError> {
        guard !ids.isEmpty else { return .success(DeleteCardsResult(deletedIDs: [], notFoundIDs: [])) }
        switch await client.cards.delete(ids: ids) {
        case .success(let result):
            let deletedIDs = Set(result.deletedIDs)
            let missingCount = result.notFoundIDs.count
            let fields: [LogField] = [
                .init("operation", "delete", privacy: .public),
                .init("deleted_count", object: deletedIDs.count, privacy: .public),
                .init("missing_count", object: missingCount, privacy: .public),
            ]
            if deletedIDs.isEmpty {
                logger.warning(
                    "cards.mutation.failed",
                    fields: fields + [.init("reason", "not_found", privacy: .public)]
                )
            } else if missingCount > 0 {
                logger.warning("cards.mutation.partial", fields: fields)
            } else {
                logger.info("cards.mutation.completed", fields: fields)
            }
            if !deletedIDs.isEmpty {
                invalidateCollectionReads()
                deletedCardIDs.formUnion(deletedIDs)
                for id in deletedIDs { snapshot.removeCard(id) }
                offlineSeed.removeAll { deletedIDs.contains($0.card.id) }
                setCards(cards.filter { !deletedIDs.contains($0.card.id) })
                if collectionState.status == .loaded { collectionState.status = .idle }
                await refresh(force: true)
                await onCollectionMutation?()
            }
            return .success(result)
        case .failure:
            logger.warning(
                "cards.mutation.failed",
                fields: [
                    .init("operation", "delete", privacy: .public),
                    .init("reason", "unavailable", privacy: .public),
                ]
            )
            return .failure(.serverUnavailable)
        }
    }

    private enum Mutation: String {
        case create, update, move
    }

    private func logMutation<Value>(_ operation: Mutation, result: Result<Value, TCGCardsOperationError>) {
        switch result {
        case .success:
            logger.info(
                "cards.mutation.completed",
                fields: [
                    .init("operation", operation.rawValue, privacy: .public)
                ]
            )
        case .failure(let error):
            let reason: String
            switch error {
            case .validation: reason = "validation"
            case .notFound: reason = "not_found"
            case .serverUnavailable: reason = "unavailable"
            }
            logger.warning(
                "cards.mutation.failed",
                fields: [
                    .init("operation", operation.rawValue, privacy: .public),
                    .init("reason", reason, privacy: .public),
                ]
            )
        }
    }

    public func exportCards() async -> Result<URL, CardsExportError> {
        switch await client.cards.exportCards() {
        case .success(let collection): return CardsCSV.export(collection).mapError { _ in .fileWriteFailed }
        case .failure(let error): return .failure(.collection(error))
        }
    }

    public func downloadCardsTemplate() -> Result<URL, CardsExportError> {
        CardsCSV.export([]).mapError { _ in .fileWriteFailed }
    }

    func importCards(_ payload: ImportCardsPayload) async -> Result<CardsImportCompletion, CardBackupErrors> {
        switch await client.cards.importCards(payload) {
        case .failure(let error): return .failure(error)
        case .success(let result):
            allocationAdjustments = result.allocationAdjustments ?? 0
            invalidateCollectionReads()
            await onCollectionMutation?()
            let refresh = await refreshCollection(force: true)
            return .success(.init(result: result, needsRefresh: (try? refresh.get()) == nil))
        }
    }

    func retryImportRefresh() async -> Bool {
        let result = await refreshCollection(force: true)
        return (try? result.get()) != nil
    }

    func invalidateCollectionReads() {
        collectionRevision += 1
        snapshot.invalidateReads()
        accountGeneration = UUID()
        collectionState.generation += 1
        collectionState.status = .idle
        clearVisiblePricing()
        listReads.clear()
        detailReads.clear()
    }

    func refresh(force: Bool) async {
        guard !isShowingBinder else { return }

        let identity = displayIdentity
        displayRefreshError = nil
        let result = await refreshCollection(force: force)
        guard identity == displayIdentity, !Task.isCancelled else { return }
        if case .failure(let error) = result { displayRefreshError = error }
    }

    private func refreshCollection(force: Bool) async -> Result<Void, TCGCardsOperationError> {
        await loadCollection(
            .init(
                game: collectionState.game,
                setNames: collectionState.setNames,
                query: collectionState.query,
                pageCount: max(1, collectionState.pageCount),
                illustrators: collectionState.illustrators
            ),
            force: force
        )
    }

    private func setCards(_ cards: [CardWithPrice]) {
        self.cards = cards.filter { entry in
            guard !deletedCardIDs.contains(entry.card.id) else { return false }

            if let selectedCollection {
                let collectionID = selectedCollection.isUnfiled ? nil : selectedCollection.id
                guard entry.card.collectionID == collectionID else { return false }
            }

            if let game = collectionState.game {
                guard entry.card.game == game else { return false }
            }

            if let query = collectionState.query?.trimmingByWhitespacesAndNewLines,
                !query.isEmpty, !entry.card.matchesSearch(query)
            {
                return false
            }

            let matchesSet = collectionState.setNames.isEmpty || collectionState.setNames.contains(entry.card.setName)
            guard matchesSet else { return false }

            guard !collectionState.illustrators.isEmpty else { return true }
            guard entry.card.game == .pokemon else { return false }

            return collectionState.illustrators.contains {
                $0.caseInsensitiveCompare(entry.card.illustrator ?? "") == .orderedSame
            }
        }
    }

    private func insertCard(_ card: CardWithPrice) {
        setCards(cards.prepended(card))
    }

    private func replaceCard(_ card: CardWithPrice, id: UUID) {
        setCards(cards.map { $0.card.id == id ? card : $0 })
    }

    private struct CollectionState {
        var game: ClientCardGame?
        var setNames: Set<String> = []
        var illustrators: Set<String>
        var query: String?
        var generation = 0
        var status: Status = .idle
        var nextCursor: String?
        var visitedCursors: Set<String> = []
        var pageCount = 0

        enum Status {
            case idle
            case loading
            case loaded
        }
    }

    private struct CollectionRequest {
        let game: ClientCardGame?
        let setNames: Set<String>
        let query: String?
        let pageCount: Int
        let illustrators: Set<String>
    }

    private func mapCreateError(_ error: CreateCardErrors) -> TCGCardsOperationError {
        switch error {
        case .badRequest(let issues): .validation(mapIssues(issues))
        case .unauthorized, .unavailable, .unknown: .serverUnavailable
        }
    }

    private func mapUpdateError(_ error: UpdateCardErrors) -> TCGCardsOperationError {
        switch error {
        case .badRequest(let issues): .validation(mapIssues(issues))
        case .notFound: .notFound
        case .unauthorized, .unavailable, .unknown: .serverUnavailable
        }
    }

    private func mapIssues(_ issues: [TCGClientValidationIssue]) -> [TCGCardsValidationIssue] {
        issues.compactMap { issue in
            guard let path = issue.path.first else { return nil }
            guard let field = TCGCardsValidationField(rawValue: path) else { return nil }
            return .init(field: field, message: issue.message)
        }
    }
}
