//
//  TCGSearch.swift
//  TCGFeatures
//

import Foundation
import KamaalLogger
import Observation
import TCGClient

private let logger = KamaalLogger(from: TCGSearch.self)

@MainActor
@Observable
public final class TCGSearch {
    private(set) var results: [PricedCard] = []
    private(set) var isSearching = false
    private(set) var hasSearched = false
    private(set) var completedSearch: SearchIdentity?
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

    func search(game: ClientCardGame, query: String, languages: Set<ClientCardLanguage> = []) async -> Result<
        Void, TCGSearchOperationError
    > {
        await searchWithOutcome(game: game, query: query, languages: languages).map { _ in () }
    }

    func searchWithOutcome(game: ClientCardGame, query: String, languages: Set<ClientCardLanguage>) async -> Result<
        Bool, TCGSearchOperationError
    > {
        let searchID = UUID()
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
        results = []
        hasSearched = false
        completedSearch = nil
    }
}
