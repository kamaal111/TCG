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
    private(set) var completedSearch: SearchIdentity?
    private(set) var displayRefreshError: TCGSearchOperationError?
    let history: TCGSearchHistoryStore

    struct SearchIdentity: Equatable {
        let game: ClientCardGame
        let query: String
        let languages: [ClientCardLanguage]

        init(game: ClientCardGame, query: String, languages: Set<ClientCardLanguage>) {
            self.game = game
            self.query = query.trimmingCharacters(in: .whitespacesAndNewlines)
            self.languages = ClientCardLanguage.normalized(languages, for: game)
        }
    }

    private let client: TCGClient
    private var activeSearchID: UUID?
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
        let result = await search(game: request.game, query: request.query, languages: Set(request.languages))
        guard displayIdentity == identity, !Task.isCancelled else { return }
        if case .failure(let error) = result { displayRefreshError = error }
    }

    func search(game: ClientCardGame, query: String, languages: Set<ClientCardLanguage> = []) async -> Result<
        Void, TCGSearchOperationError
    > {
        await searchWithOutcome(game: game, query: query, languages: languages).map { _ in () }
    }

    func searchWithOutcome(game: ClientCardGame, query: String, languages: Set<ClientCardLanguage>) async -> Result<
        Bool, TCGSearchOperationError
    > {
        let searchID = UUID()
        lastSearch = SearchIdentity(game: game, query: query, languages: languages)
        activeSearchID = searchID
        isSearching = true
        defer {
            if activeSearchID == searchID {
                activeSearchID = nil
                isSearching = false
            }
        }

        let result = await client.pricing.search(game: game, query: query, languages: languages)
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
                hasSearched = true
                completedSearch = SearchIdentity(game: game, query: query, languages: languages)
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

    func cancel() {
        activeSearchID = nil
        isSearching = false
    }

    func clear() {
        cancel()
        displayRefreshError = nil
        results = []
        hasSearched = false
        completedSearch = nil
    }
}
