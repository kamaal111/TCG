//
//  TCGSearch.swift
//  TCGFeatures
//

import Foundation
import KamaalLogger
import Observation
import TCGClient
import TCGCurrency

private let logger = KamaalLogger(from: TCGSearch.self)

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
            self.query = request.query.trimmingCharacters(in: .whitespacesAndNewlines)
            self.languages = ClientCardLanguage.normalized(request.languages, for: game)
        }
    }

    private let client: TCGClient
    private var activeSearchID: UUID?
    private var activePageID: UUID?
    private var displayIdentity: TCGCurrency.DisplayIdentity?
    private var lastSearch: SearchIdentity?

    init(client: TCGClient, history: TCGSearchHistoryStore) {
        self.client = client
        self.history = history
    }

    /// Creates search state with the production client and device-local history.
    ///
    /// - Returns: A feature whose history persists across app launches.
    public static func `default`() -> TCGSearch {
        TCGSearch(client: .default(), history: TCGSearchHistoryStore(defaults: .standard))
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
                "Cancelled a superseded card pricing search; game=\(game.rawValue); queryLength=\(query.count)"
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
                return true
            }
            .mapError { error -> TCGSearchOperationError in
                switch error {
                case .badRequest(let validations):
                    logger.warning(
                        "Card pricing search failed; reason=invalid_query; game=\(game.rawValue); "
                            + "queryLength=\(query.count); validationCount=\(validations.count)"
                    )
                    return TCGSearchOperationError.invalidQuery
                case .unauthorized:
                    logger.warning(
                        "Card pricing search failed; reason=unauthorized; game=\(game.rawValue); "
                            + "queryLength=\(query.count)"
                    )
                    return TCGSearchOperationError.serverUnavailable
                case .unavailable:
                    logger.warning(
                        "Card pricing search failed; reason=server_unavailable; game=\(game.rawValue); "
                            + "queryLength=\(query.count)"
                    )
                    return TCGSearchOperationError.serverUnavailable
                case .unknown(let status, _, let cause):
                    let label =
                        "Card pricing search failed; reason=unknown; status=\(status); game=\(game.rawValue); "
                        + "queryLength=\(query.count)"
                    if let cause {
                        logger.error(label: label, error: cause)
                    } else {
                        logger.error(label)
                    }
                    return TCGSearchOperationError.serverUnavailable
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
