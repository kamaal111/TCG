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

    var allocationAdjustments = 0
    var onCollectionMutation: (@MainActor () async -> Void)?
    private(set) var selectedCollection: CardBinderCollection?
    private let client: TCGClient
    private var collectionState = CollectionState(illustrators: [])
    private var displayIdentity: TCGCurrency.DisplayIdentity?

    var isLoading: Bool { collectionState.status == .loading }
    var hasMoreCards: Bool { collectionState.nextCursor != nil }

    var hasLoadedCurrentCollection: Bool { collectionState.status == .loaded }

    init(client: TCGClient) {
        self.client = client
    }

    public static func `default`() -> TCGCards { TCGCards(client: .default()) }

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

    func allCardsInSelectedCollection() async -> Result<[CardWithPrice], TCGCardsOperationError> {
        let identity = selectedCollection?.id
        var result: [CardWithPrice] = []
        var cursor: String?
        var visited: Set<String> = []
        repeat {
            guard selectedCollection?.id == identity else { return .failure(.serverUnavailable) }
            switch await client.cards.listPage(
                .init(game: nil, setNames: [], cursor: cursor, collectionID: identity, query: nil, illustrators: [])
            ) {
            case .failure: return .failure(.serverUnavailable)
            case .success(let page):
                result.append(contentsOf: page.cards)
                cursor = page.nextCursor
                if let cursor { guard visited.insert(cursor).inserted else { return .failure(.serverUnavailable) } }
            }
        } while cursor != nil
        guard selectedCollection?.id == identity else { return .failure(.serverUnavailable) }
        return .success(result)
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
        invalidateDisplayPrices()
        if needsRefresh { await refresh() }
    }

    private func invalidateDisplayPrices() {
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

        var pages = CollectionPages(cards: cards, state: collectionState)
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
        setCards(cards)

        var pages = CollectionPages(cards: [], state: .init(illustrators: []))

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
        } while pages.nextCursor != nil && pages.pageCount < request.pageCount

        publish(pages)
        return .success(())
    }

    private func loadPage(into pages: inout CollectionPages, generation: Int) async -> Result<
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

    private func publish(_ pages: CollectionPages) {
        setCards(pages.cards)
        availableSetNames = pages.availableSetNames
        availableIllustrators = pages.availableIllustrators
        collectionState.nextCursor = pages.nextCursor
        collectionState.visitedCursors = pages.visitedCursors
        collectionState.pageCount = pages.pageCount
        collectionState.status = .loaded
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
        let identity = displayIdentity
        let result = await client.cards.update(id: id, with: values.payload)
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
            if let selectedCollection {
                let collectionID = selectedCollection.isUnfiled ? nil : selectedCollection.id
                guard entry.card.collectionID == collectionID else { return false }
            }

            if let game = collectionState.game {
                guard entry.card.game == game else { return false }
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

    private struct CollectionPages {
        var cards: [CardWithPrice]
        var availableSetNames: Set<String> = []
        var availableIllustrators: Set<String> = []
        var nextCursor: String?
        var visitedCursors: Set<String>
        var pageCount: Int

        private var cardIDs: Set<UUID>

        init(cards: [CardWithPrice], state: CollectionState) {
            self.cards = cards
            nextCursor = state.nextCursor
            visitedCursors = state.visitedCursors
            pageCount = state.pageCount
            cardIDs = Set(cards.map(\.card.id))
        }

        mutating func append(_ page: CardCollectionPage) -> Bool {
            if let next = page.nextCursor {
                guard !next.isEmpty else { return false }
                guard visitedCursors.insert(next).inserted else { return false }
            }

            cards.append(contentsOf: page.cards.filter { cardIDs.insert($0.card.id).inserted })
            availableSetNames = page.availableSetNames
            availableIllustrators = page.availableIllustrators
            nextCursor = page.nextCursor
            pageCount += 1
            return true
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
