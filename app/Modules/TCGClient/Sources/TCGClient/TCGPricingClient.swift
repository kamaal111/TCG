//
//  TCGPricingClient.swift
//  TCGClient
//

import OpenAPIRuntime

public protocol TCGPricingClient: Sendable {
    /// Searches using an explicit game, query, language selection, and search mode.
    func search(_ request: PricingSearchQuery) async -> Result<
        CardSearchResult, SearchPricingErrors
    >
}

struct TCGPricingClientImpl: TCGPricingClient {
    private let client: Client

    init(client: Client) {
        self.client = client
    }

    func search(_ request: PricingSearchQuery) async -> Result<
        CardSearchResult, SearchPricingErrors
    > {
        let game = request.game
        let selected = ClientCardLanguage.normalized(request.languages, for: game)
        let languageQuery = selected.isEmpty ? nil : selected.map(\.rawValue).joined(separator: ",")
        let response: Operations.GetAppApiPricingSearch.Output
        do {
            response = try await client.getAppApiPricingSearch(
                query: .init(
                    searchBy: Self.makeSearchMode(request.mode),
                    languages: languageQuery,
                    game: Self.makeSearchGame(game),
                    query: request.query
                )
            )
        } catch {
            return .failure(.unknown(status: 503, payload: nil, cause: error))
        }

        switch response {
        case .ok(let response):
            do {
                return .success(Self.makeSearchResult(try response.body.json))
            } catch {
                return .failure(.unknown(status: 503, payload: nil, cause: error))
            }
        case .badRequest(let response):
            return .failure(
                .badRequest(validations: TCGClientValidationErrorParser.parseIssues(from: try? response.body.json))
            )
        case .unauthorized:
            return .failure(.unauthorized)
        case .serviceUnavailable:
            return .failure(.unavailable)
        case .undocumented(let status, let payload):
            return .failure(.unknown(status: status, payload: payload, cause: nil))
        }
    }

    private static func makeSearchResult(_ result: Components.Schemas.PricingSearchResponse) -> CardSearchResult {
        CardSearchResult(
            matches: result.matches.map { PricedCardMapper.makePricedCard($0) }
        )
    }

    private static func makeSearchMode(_ mode: ClientCardSearchMode)
        -> Operations.GetAppApiPricingSearch.Input.Query
        .SearchByPayload
    {
        switch mode {
        case .card: .card
        case .illustrator: .illustrator
        }
    }

    private static func makeSearchGame(
        _ game: ClientCardGame
    ) -> Operations.GetAppApiPricingSearch.Input.Query.GamePayload {
        switch game {
        case .onePiece: .onePiece
        case .pokemon: .pokemon
        }
    }
}
