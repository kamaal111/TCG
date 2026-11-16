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

private let logger = KamaalLogger(from: TCGCards.self)

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
    private(set) var deletedCardIDs: Set<UUID> = []
    private(set) var isLoadingPrices = false
    private var priceTask: Task<Void, Never>?
    private var account: String?
    private var offlineSeed: [CardWithPrice] = []
    var onCollectionNotFound: (@MainActor (UUID) async -> Void)?

    var allocationAdjustments = 0
    var onCollectionMutation: (@MainActor () async -> Void)?
    private(set) var selectedCollection: CardBinderCollection?
    private let client: TCGClient
    private var downloadedCards: [CardWithPrice]?
    var isReadOnly: Bool { downloadedCards != nil }
    private var collectionState = CollectionState(illustrators: [])
    private var displayIdentity: TCGCurrency.DisplayIdentity?

    var isLoading: Bool { collectionState.status == .loading }
    var hasMoreCards: Bool { collectionState.nextCursor != nil }

    var hasLoadedCurrentCollection: Bool { collectionState.status == .loaded }

    init(client: TCGClient, snapshot: CollectionSnapshotCache = CollectionSnapshotCache()) {
        self.client = client
        self.snapshot = snapshot
    }

    public static func `default`() -> TCGCards { TCGCards(client: .default()) }

    func useAccount(_ account: String?) {
        guard self.account != account else { return }

        self.account = account
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
        (snapshot.rows(for: scope) ?? offlineSeed.filter { cardIDs.contains($0.card.id) }).map(compatibleDisplay)
    }

    private var scope: CollectionSnapshotCache.Scope {
        .init(
            collectionID: selectedCollection?.id,
            game: collectionState.game,
            sets: collectionState.setNames.sorted(),
            illustrators: collectionState.illustrators.map { $0.lowercased() }.sorted(),
            query: collectionState.query?.trimmingCharacters(in: .whitespacesAndNewlines)
        )
    }

    func compatibleDisplay(_ entry: CardWithPrice) -> CardWithPrice {
        let cachedCurrency = entry.card.displayCurrency ?? entry.price.price?.display?.preferredCurrency
        guard let displayIdentity, cachedCurrency != displayIdentity.currency else { return entry }

        return .init(
            card: entry.card.replacingDisplay(with: nil),
            price: .init(cardId: entry.card.id, status: .pending),
            imageURL: entry.imageURL
        )
    }

    func validateCard(_ entry: CardWithPrice) async -> Result<CardWithPrice, OwnedCardReadError> {
        guard !isReadOnly else { return .success(entry) }

        let owner = account
        let collectionID = selectedCollection?.id
        let result = await client.cards.details(id: entry.card.id)
        guard account == owner, selectedCollection?.id == collectionID, !Task.isCancelled else {
            return .failure(.unavailable)
        }

        switch result {
        case .success(let details):
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

    func refreshedPrices(for rows: [CardWithPrice]) async -> [CardWithPrice] {
        let owner = account
        let currency = displayIdentity
        let ids = Array(Set(rows.map(\.card.id)))
        var prices: [UUID: OwnedCardPriceUpdate] = [:]
        for start in stride(from: 0, to: ids.count, by: 100) {
            guard !Task.isCancelled else { return rows }

            let end = min(start + 100, ids.count)
            if case .success(let response) = await client.cards.prices(ids: Array(ids[start..<end])) {
                for entry in response { prices[entry.cardID] = entry }
            }
        }

        guard owner == account, currency == displayIdentity, !Task.isCancelled else { return rows }

        return rows.map { row in
            guard let price = prices[row.card.id], price.updatedAt == row.card.updatedAt,
                price.price.status != .unavailable,
                currency == nil || price.displayCurrency == currency?.currency
            else { return row }

            return .init(
                card: row.card.applyingPriceUpdate(price),
                price: price.price,
                imageURL: row.imageURL
            )
        }
    }

    func keepingPrice(for details: CardWithPrice, cached: CardWithPrice?) -> CardWithPrice {
        guard details.price.status == .pending, let cached, cached.card.updatedAt == details.card.updatedAt,
            cached.card.displayCurrency == details.card.displayCurrency
        else { return details }

        return .init(
            card: details.card.replacingDisplay(with: cached.card),
            price: cached.price,
            imageURL: details.imageURL ?? cached.imageURL
        )
    }

    private func refreshVisiblePrices() {
        priceTask?.cancel()
        let generation = collectionState.generation
        let rows = cards
        isLoadingPrices = !rows.isEmpty
        guard isLoadingPrices else { return }

        priceTask = Task { [weak self] in
            guard let self else { return }

            let refreshed = await refreshedPrices(for: rows)
            guard generation == collectionState.generation, !Task.isCancelled else { return }

            let byID = Dictionary(refreshed.map { ($0.card.id, $0) }, uniquingKeysWith: { first, _ in first })
            setCards(
                cards.map { row in
                    guard let updated = byID[row.card.id], updated.card.updatedAt == row.card.updatedAt else {
                        return row
                    }
                    return updated
                }
            )
            snapshot.save(cards, for: scope)
            isLoadingPrices = false
        }
    }

    func useDownloadedCards(_ cards: [CardWithPrice]) {
        downloadedCards = cards
        invalidateDisplayPrices()
    }

    func restoreCollection(_ collection: CardBinderCollection?) {
        selectedCollection = collection
        invalidateDisplayPrices()
        setCards((snapshot.rows(for: scope) ?? offlineSeed).map(compatibleDisplay))
    }

    func selectCollection(_ collection: CardBinderCollection?) async {
        let changed = selectedCollection?.id != collection?.id
        selectedCollection = collection
        if changed || !hasLoadedCurrentCollection {
            invalidateDisplayPrices()
            _ = await load(game: nil, setNames: [], query: nil, illustrators: [])
        }
    }

    func clearCollectionSelection() {
        selectedCollection = nil
        allocationAdjustments = 0
        invalidateDisplayPrices()
    }

    func cardPage(_ query: ListCardsQuery) async -> Result<CardCollectionPage, TCGCardsOperationError> {
        let identity = selectedCollection?.id
        let generation = collectionState.generation
        let result = await client.cards.listPage(query).mapError { _ in TCGCardsOperationError.serverUnavailable }
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

    public func refreshDisplayPrices(for identity: TCGCurrency.DisplayIdentity) async {
        guard displayIdentity != identity else { return }
        guard displayIdentity != nil else {
            displayIdentity = identity
            return
        }
        let needsRefresh = collectionState.pageCount > 0 || isLoading || !cards.isEmpty
        displayIdentity = identity
        priceTask?.cancel()
        isLoadingPrices = false
        setCards(cards.map(compatibleDisplay))
        if needsRefresh { await refresh() }
    }

    private func invalidateDisplayPrices() {
        priceTask?.cancel()
        isLoadingPrices = false
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
            .init(game: game, setNames: setNames, query: query, pageCount: pageCount, illustrators: illustrators)
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
        let result = await loadPage(into: &pages, generation: generation)

        guard generation == collectionState.generation else { return .success(()) }

        isLoadingNextPage = false

        switch result {
        case .failure(let error):
            nextPageError = error
            return .failure(error)
        case .success(let didLoadPage):
            guard didLoadPage else { return .success(()) }

            publish(pages)
            return .success(())
        }
    }

    private func loadCollection(_ request: CollectionRequest) async -> Result<Void, TCGCardsOperationError> {
        let previousScope = scope
        priceTask?.cancel()
        isLoadingPrices = false
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
            let query = request.query?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            setCards(query.isEmpty ? scoped : scoped.filter { $0.card.matchesSearch(query) })
            collectionState.status = .loaded
            return .success(())
        }

        var pages = CardCollectionPages()

        repeat {
            let result = await loadPage(into: &pages, generation: generation)

            guard generation == collectionState.generation else { return .success(()) }

            switch result {
            case .failure(let error):
                collectionState.status = .idle
                return .failure(error)
            case .success(let didLoadPage):
                guard didLoadPage else {
                    collectionState.status = .idle
                    return .success(())
                }
            }
            let hasMoreRequestedPages = pages.nextCursor != nil && pages.pageCount < request.pageCount
            publish(pages, isFinal: !hasMoreRequestedPages)
        } while pages.nextCursor != nil && pages.pageCount < request.pageCount

        return .success(())
    }

    private func loadPage(into pages: inout CardCollectionPages, generation: Int) async -> Result<
        Bool, TCGCardsOperationError
    > {
        guard generation == collectionState.generation else { return .success(false) }
        guard !Task.isCancelled else { return .success(false) }

        let result = await client.cards.listPage(
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

            return .success(true)
        }
    }

    private func publish(_ pages: CardCollectionPages, isFinal: Bool = true) {
        let cached = Dictionary(cards.map { ($0.card.id, $0) }, uniquingKeysWith: { first, _ in first })
        setCards(
            pages.cards.map { details in
                keepingPrice(for: details, cached: cached[details.card.id])
            }
        )
        snapshot.save(cards, for: scope)
        if pages.cards.contains(where: { $0.price.status == .pending }) { refreshVisiblePrices() }
        availableSetNames = pages.availableSetNames
        availableIllustrators = pages.availableIllustrators
        collectionState.nextCursor = pages.nextCursor
        collectionState.visitedCursors = pages.visitedCursors
        collectionState.pageCount = pages.pageCount
        collectionState.status = isFinal ? .loaded : .loading
    }

    func purchaseDefault(game: ClientCardGame, name: String, cardNumber: String) async -> Result<
        CardSearchResult, SearchPricingErrors
    > {
        await client.pricing.search(
            .init(game: game, query: "\(name) \(cardNumber)", languages: [], mode: .card, cursor: nil)
        )
    }

    func addCard(_ values: CardFormValues) async -> Result<Void, TCGCardsOperationError> {
        let identity = displayIdentity
        let result = await client.cards.create(with: values.payload)
            .map { card in if displayIdentity == identity { insertCard(card) } }
            .mapError(mapCreateError)
        if case .success = result {
            await refresh()
            await onCollectionMutation?()
        }
        return result
    }

    func updateCard(id: UUID, values: CardFormValues) async -> Result<CardWithPrice, TCGCardsOperationError> {
        await updateCard(id: id, payload: values.payload)
    }

    func moveCard(_ card: Card, to collectionID: UUID) async -> Result<CardWithPrice, TCGCardsOperationError> {
        let payload = UpsertCardPayload(
            game: card.game,
            name: card.name,
            setName: card.setName,
            cardNumber: card.cardNumber,
            notes: card.notes,
            purchases: card.purchases,
            collectionID: collectionID
        )
        return await updateCard(id: card.id, payload: payload)
    }

    private func updateCard(id: UUID, payload: UpsertCardPayload) async -> Result<CardWithPrice, TCGCardsOperationError>
    {
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
        if case .success = result {
            await refresh()
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
            if !deletedIDs.isEmpty {
                deletedCardIDs.formUnion(deletedIDs)
                for id in deletedIDs { snapshot.removeCard(id) }
                offlineSeed.removeAll { deletedIDs.contains($0.card.id) }
                setCards(cards.filter { !deletedIDs.contains($0.card.id) })
                if collectionState.status == .loaded { collectionState.status = .idle }
                await refresh()
                await onCollectionMutation?()
            }
            return .success(result)
        case .failure:
            return .failure(.serverUnavailable)
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

    func importCards(_ drafts: [CSVImportCard]) async -> Result<CardsImportCompletion, CardBackupErrors> {
        let now = Date()
        let cards = drafts.compactMap { CardsCSV.makeCard($0, now: now) }
        let payload = ImportCardsPayload(cards: cards.map(ImportCardPayload.init))
        switch await client.cards.importCards(payload) {
        case .failure(let error): return .failure(error)
        case .success(let result):
            allocationAdjustments = result.allocationAdjustments ?? 0
            await onCollectionMutation?()
            let refresh = await refreshCollection()
            return .success(.init(result: result, needsRefresh: (try? refresh.get()) == nil))
        }
    }

    func retryImportRefresh() async -> Bool {
        let result = await refreshCollection()
        return (try? result.get()) != nil
    }

    func refresh() async {
        let identity = displayIdentity
        displayRefreshError = nil
        let result = await refreshCollection()
        guard identity == displayIdentity, !Task.isCancelled else { return }
        if case .failure(let error) = result { displayRefreshError = error }
    }

    private func refreshCollection() async -> Result<Void, TCGCardsOperationError> {
        await loadCollection(
            .init(
                game: collectionState.game,
                setNames: collectionState.setNames,
                query: collectionState.query,
                pageCount: max(1, collectionState.pageCount),
                illustrators: collectionState.illustrators
            )
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

            if let query = collectionState.query?.trimmingCharacters(in: .whitespacesAndNewlines),
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
            let message =
                issue.code == "binder_full"
                ? String(
                    localized: "This binder is full. Choose another collection or increase its page dimensions.",
                    bundle: .module
                )
                : issue.message
            return .init(field: field, message: message)
        }
    }
}
