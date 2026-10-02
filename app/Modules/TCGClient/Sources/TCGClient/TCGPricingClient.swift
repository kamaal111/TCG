//
//  TCGPricingClient.swift
//  TCGClient
//

import OpenAPIRuntime

public protocol TCGPricingClient: Sendable {
    /// Searches card prices with a language selection; for example, `search(game: .pokemon, query: "Shiftry", languages: [.japanese])`.
    func search(game: ClientCardGame, query: String, languages: Set<ClientCardLanguage>) async -> Result<
        CardSearchResult, SearchPricingErrors
    >
}

extension TCGPricingClient {
    /// Searches across all card languages, for example `await search(game: .pokemon, query: "Pikachu")`.
    public func search(game: ClientCardGame, query: String) async -> Result<CardSearchResult, SearchPricingErrors> {
        await search(game: game, query: query, languages: [])
    }
}

struct TCGPricingClientImpl: TCGPricingClient {
    private let client: Client

    init(client: Client) {
        self.client = client
    }

    func search(game: ClientCardGame, query: String, languages: Set<ClientCardLanguage>) async -> Result<
        CardSearchResult, SearchPricingErrors
    > {
        let selected = ClientCardLanguage.normalized(languages, for: game)
        let languageQuery = selected.isEmpty ? nil : selected.map(\.rawValue).joined(separator: ",")
        let response: Operations.GetAppApiPricingSearch.Output
        do {
            response = try await client.getAppApiPricingSearch(
                query: .init(languages: languageQuery, game: Self.makeSearchGame(game), query: query)
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

    private static func makeSearchGame(
        _ game: ClientCardGame
    ) -> Operations.GetAppApiPricingSearch.Input.Query.GamePayload {
        switch game {
        case .onePiece: .onePiece
        case .pokemon: .pokemon
        }
    }
}
