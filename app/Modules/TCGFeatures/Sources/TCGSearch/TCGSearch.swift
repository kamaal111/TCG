//
//  TCGSearch.swift
//  TCGFeatures
//

import KamaalLogger
import Observation
import TCGClient

private let logger = KamaalLogger(from: TCGSearch.self)

@MainActor
@Observable
public final class TCGSearch {
    private(set) var results: [PricedCard] = []
    private(set) var isSearching = false
    private(set) var status: CardSearchStatus?

    private let client: TCGClient

    init(client: TCGClient) {
        self.client = client
    }

    public static func `default`() -> TCGSearch { TCGSearch(client: .default()) }

    func search(game: CardGame, query: String) async -> Result<Void, TCGSearchOperationError> {
        isSearching = true
        defer { isSearching = false }

        return await client.pricing.search(game: game, query: query)
            .map { result in
                results = result.matches
                status = result.status
            }
            .mapError { error -> TCGSearchOperationError in
                logger.error("Couldn't search card pricing.")
                return switch error {
                case .badRequest: TCGSearchOperationError.invalidQuery
                case .unauthorized, .unavailable, .unknown: TCGSearchOperationError.serverUnavailable
                }
            }
    }

    func clear() {
        results = []
        status = nil
    }
}
