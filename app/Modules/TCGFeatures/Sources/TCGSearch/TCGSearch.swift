//
//  TCGSearch.swift
//  TCGFeatures
//

import Foundation
import KamaalExtensions
import KamaalLogger
import Observation
import TCGClient
import TCGCurrency

@MainActor
@Observable
public final class TCGSearch {
    private(set) var results: [PricedCard] = []
    private(set) var isSearching = false
    private(set) var hasSearched = false
    private(set) var nextCursor: String?
    private(set) var didFailToLoadNextPage = false

    var isLoadingNextPage: Bool { activePageID != nil }
    private(set) var completedSearch: SearchIdentity?
    private(set) var displayRefreshError: TCGSearchOperationError?
    let history: TCGSearchHistoryStore

    struct SearchIdentity: Equatable {
        let game: ClientCardGame
        let query: String
        let mode: ClientCardSearchMode
        let languages: [ClientCardLanguage]

        init(_ request: PricingSearchQuery) {
            let game = request.game
            self.mode = request.mode
            self.game = game
            self.query = request.query.trimmingByWhitespacesAndNewLines
            self.languages = ClientCardLanguage.normalized(request.languages, for: game)
        }
    }

    private let client: TCGClient
    private let logger: KamaalLogger
    private var activeSearchID: UUID?
    private var activePageID: UUID?
    private var displayIdentity: TCGCurrency.DisplayIdentity?
    private var lastSearch: SearchIdentity?

    convenience init(client: TCGClient, history: TCGSearchHistoryStore) {
        self.init(client: client, history: history, logger: KamaalLogger(from: TCGSearch.self))
    }

    init(client: TCGClient, history: TCGSearchHistoryStore, logger: KamaalLogger) {
        self.client = client
        self.logger = logger
        self.history = history
    }

    /// Creates search state with the production client and device-local history.
    ///
    /// - Returns: A feature whose history persists across app launches.
    public static func `default`() -> TCGSearch {
        TCGSearch(client: .default(), history: TCGSearchHistoryStore(defaults: .standard, now: Date.init))
    }

    public func resetDisplayPrices() {
        displayIdentity = nil
        lastSearch = nil
        clear()
    }

    public func refreshDisplayPrices(for identity: TCGCurrency.DisplayIdentity) async {
        guard displayIdentity != identity else { return }
        guard displayIdentity != nil else {
            displayIdentity = identity
            return
        }
        displayIdentity = identity
        clear()
        await refresh()
    }

    func refresh() async {
        guard let request = lastSearch else { return }
        let identity = displayIdentity
        displayRefreshError = nil
        let result = await searchWithOutcome(
            .init(
                game: request.game,
                query: request.query,
                languages: Set(request.languages),
                mode: request.mode,
                cursor: nil
            )
        )
        guard displayIdentity == identity, !Task.isCancelled else { return }
        if case .failure(let error) = result { displayRefreshError = error }
    }

    func search(_ request: PricingSearchQuery) async -> Result<Void, TCGSearchOperationError> {
        await searchWithOutcome(request).map { _ in () }
    }

    func searchWithOutcome(_ request: PricingSearchQuery) async -> Result<Bool, TCGSearchOperationError> {
        let game = request.game
        let query = request.query
        let searchID = UUID()
        lastSearch = SearchIdentity(request)
        activePageID = nil
        if completedSearch != lastSearch {
            nextCursor = nil
            didFailToLoadNextPage = false
        }
        activeSearchID = searchID
        isSearching = true
        defer {
            if activeSearchID == searchID {
                activeSearchID = nil
                isSearching = false
            }
        }

        let result = await client.pricing.search(request)
        guard !Task.isCancelled, activeSearchID == searchID else {
            logger.info(
                "Cancelled a superseded card pricing search",
                fields: [
                    .init("game", game.rawValue, privacy: .public),
                    .init("queryLength", object: query.count, privacy: .public),
                ]
            )
            return .success(false)
        }

        return
            result
            .map { result in
                results = result.matches
                nextCursor = result.nextCursor
                didFailToLoadNextPage = false
                hasSearched = true
                completedSearch = SearchIdentity(request)
                if request.cursor == nil {
                    logger.info(
                        "pricing.search.completed",
                        fields: [
                            .init("game", game.rawValue, privacy: .public),
                            .init("result_count", object: result.matches.count, privacy: .public),
                        ]
                    )
                }
                return true
            }
            .mapError { error -> TCGSearchOperationError in
                let context: [LogField] = [
                    .init("game", game.rawValue, privacy: .public),
                    .init("queryLength", object: query.count, privacy: .public),
                ]
                switch error {
                case .badRequest(let validations):
                    logger.warning(
                        "Card pricing search failed",
                        fields: [
                            .init("reason", "invalid_query", privacy: .public),
                            .init("validationCount", object: validations.count, privacy: .public),
                        ] + context
                    )
                    return .invalidQuery
                case .unauthorized:
                    logger.warning(
                        "Card pricing search failed",
                        fields: [
                            .init("reason", "unauthorized", privacy: .public)
                        ] + context
                    )
                    return .serverUnavailable
                case .unavailable:
                    logger.warning(
                        "Card pricing search failed",
                        fields: [
                            .init("reason", "server_unavailable", privacy: .public)
                        ] + context
                    )
                    return .serverUnavailable
                case .unknown(let status, _, let cause):
                    let details: [LogField] =
                        cause.map {
                            [.init("description", $0.localizedDescription), .init("error", String(describing: $0))]
                        } ?? []
                    logger.error(
                        "Card pricing search failed",
                        fields: [
                            .init("reason", "unknown", privacy: .public),
                            .init("status", "\(status)", privacy: .public),
                        ] + context + details
                    )
                    return .serverUnavailable
                }
            }
    }

    func loadNextPage(_ cursor: String, retry: Bool) async {
        guard !Task.isCancelled, !isSearching, !isLoadingNextPage, cursor == nextCursor,
            !didFailToLoadNextPage || retry, let request = completedSearch
        else { return }

        let pageID = UUID()
        activePageID = pageID
        didFailToLoadNextPage = false
        defer {
            if activePageID == pageID { activePageID = nil }
        }

        let result = await client.pricing.search(
            .init(
                game: request.game,
                query: request.query,
                languages: Set(request.languages),
                mode: request.mode,
                cursor: cursor
            )
        )
        guard !Task.isCancelled, activePageID == pageID else { return }

        switch result {
        case .success(let page):
            var seenIDs = Set(results.map(\.id))
            results.append(contentsOf: page.matches.filter { seenIDs.insert($0.id).inserted })
            nextCursor = page.nextCursor
        case .failure:
            didFailToLoadNextPage = true
        }
    }

    func setWishlistMembership(_ saved: Bool, for printingKey: String) {
        for index in results.indices where results[index].printingKey == printingKey {
            results[index].isWishlisted = saved
        }
    }

    func cancel() {
        activePageID = nil
        activeSearchID = nil
        isSearching = false
    }

    func clear() {
        cancel()
        displayRefreshError = nil
        results = []
        hasSearched = false
        nextCursor = nil
        didFailToLoadNextPage = false
        completedSearch = nil
    }
}
