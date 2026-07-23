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

    private let client: TCGClient
    private var activeSearchID: UUID?

    init(client: TCGClient) {
        self.client = client
    }

    public static func `default`() -> TCGSearch { TCGSearch(client: .default()) }

    func search(game: ClientCardGame, query: String) async -> Result<Void, TCGSearchOperationError> {
        let searchID = UUID()
        activeSearchID = searchID
        isSearching = true
        defer {
            if activeSearchID == searchID {
                activeSearchID = nil
                isSearching = false
            }
        }

        let result = await client.pricing.search(game: game, query: query)
        guard !Task.isCancelled, activeSearchID == searchID else {
            logger.info(
                "Cancelled a superseded card pricing search; game=\(game.rawValue); queryLength=\(query.count)"
            )
            return .success(())
        }

        return
            result
            .map { result in
                results = result.matches
                hasSearched = true
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

    func clear() {
        activeSearchID = nil
        isSearching = false
        results = []
        hasSearched = false
    }
}
