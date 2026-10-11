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

private let logger = KamaalLogger(from: TCGCards.self)

@MainActor
@Observable
public final class TCGCards {
    private(set) var cards: [CardWithPrice] = []
    private(set) var availableSetNames: Set<String> = []
    private(set) var isLoadingNextPage = false
    private(set) var nextPageError: TCGCardsOperationError?

    private let client: TCGClient
    private var collectionState = CollectionState()

    var isLoading: Bool { collectionState.status == .loading }
    var hasMoreCards: Bool { collectionState.nextCursor != nil }

    var hasLoadedCurrentCollection: Bool { collectionState.status == .loaded }

    init(client: TCGClient) {
        self.client = client
    }

    public static func `default`() -> TCGCards { TCGCards(client: .default()) }

    func load(game: ClientCardGame?, setNames: Set<String> = []) async -> Result<Void, TCGCardsOperationError> {
        let pageCount =
            game == collectionState.game && setNames == collectionState.setNames
            ? max(1, collectionState.pageCount) : 1

        return await loadCollection(.init(game: game, setNames: setNames, pageCount: pageCount))
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
        if request.game != collectionState.game { availableSetNames = [] }
        collectionState = CollectionState(
            game: request.game,
            setNames: request.setNames,
            generation: collectionState.generation + 1,
            status: .loading,
            pageCount: request.pageCount
        )
        let generation = collectionState.generation
        isLoadingNextPage = false
        nextPageError = nil
        setCards(cards)

        var pages = CollectionPages()

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
            game: collectionState.game,
            setNames: collectionState.setNames,
            cursor: pages.nextCursor
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
        collectionState.nextCursor = pages.nextCursor
        collectionState.visitedCursors = pages.visitedCursors
        collectionState.pageCount = pages.pageCount
        collectionState.status = .loaded
    }

    func purchaseDefault(game: ClientCardGame, name: String, cardNumber: String) async -> Result<
        CardSearchResult, SearchPricingErrors
    > {
        await client.pricing.search(game: game, query: "\(name) \(cardNumber)")
    }

    func addCard(_ values: CardFormValues) async -> Result<Void, TCGCardsOperationError> {
        let result = await client.cards.create(with: values.payload)
            .map(insertCard)
            .mapError(mapCreateError)
        if case .success = result { await refresh() }
        return result
    }

    func updateCard(id: String, values: CardFormValues) async -> Result<CardWithPrice, TCGCardsOperationError> {
        let result = await client.cards.update(id: id, with: values.payload)
            .map { card in
                replaceCard(card, id: id)
                return card
            }
            .mapError(mapUpdateError)
        if case .success = result { await refresh() }
        return result
    }

    func deleteCard(id: String) async -> Result<Void, TCGCardsOperationError> {
        await performDeletion(ids: [id]).flatMap { result in
            result.deletedIDs.contains(id) ? .success(()) : .failure(.notFound)
        }
    }

    func deleteCards(ids: [String]) async -> [TCGCardsOperationError] {
        switch await performDeletion(ids: ids) {
        case .success(let result): result.notFoundIDs.map { _ in .notFound }
        case .failure(let error): [error]
        }
    }

    private func performDeletion(ids: [String]) async -> Result<DeleteCardsResult, TCGCardsOperationError> {
        guard !ids.isEmpty else { return .success(DeleteCardsResult(deletedIDs: [], notFoundIDs: [])) }
        switch await client.cards.delete(ids: ids) {
        case .success(let result):
            let deletedIDs = Set(result.deletedIDs)
            if !deletedIDs.isEmpty {
                setCards(cards.filter { !deletedIDs.contains($0.card.id) })
                if collectionState.status == .loaded { collectionState.status = .idle }
                await refresh()
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
            let refresh = await refreshCollection()
            return .success(.init(result: result, needsRefresh: (try? refresh.get()) == nil))
        }
    }

    func retryImportRefresh() async -> Bool {
        let result = await refreshCollection()
        return (try? result.get()) != nil
    }

    private func refresh() async {
        _ = await refreshCollection()
    }

    private func refreshCollection() async -> Result<Void, TCGCardsOperationError> {
        await loadCollection(
            .init(
                game: collectionState.game,
                setNames: collectionState.setNames,
                pageCount: max(1, collectionState.pageCount)
            )
        )
    }

    private func setCards(_ cards: [CardWithPrice]) {
        self.cards = cards.filter {
            (collectionState.game == nil || $0.card.game == collectionState.game)
                && (collectionState.setNames.isEmpty || collectionState.setNames.contains($0.card.setName))
        }
    }

    private func insertCard(_ card: CardWithPrice) {
        setCards(cards.prepended(card))
    }

    private func replaceCard(_ card: CardWithPrice, id: String) {
        setCards(cards.map { $0.card.id == id ? card : $0 })
    }

    private struct CollectionState {
        var game: ClientCardGame?
        var setNames: Set<String> = []
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
        var nextCursor: String?
        var visitedCursors: Set<String>
        var pageCount: Int

        private var cardIDs: Set<String>

        init(cards: [CardWithPrice] = [], state: CollectionState = .init()) {
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
            nextCursor = page.nextCursor
            pageCount += 1
            return true
        }
    }

    private struct CollectionRequest {
        let game: ClientCardGame?
        let setNames: Set<String>
        let pageCount: Int
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
