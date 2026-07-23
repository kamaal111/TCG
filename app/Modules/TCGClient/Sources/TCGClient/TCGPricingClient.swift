//
//  TCGPricingClient.swift
//  TCGClient
//

import OpenAPIRuntime

public protocol TCGPricingClient: Sendable {
    func search(game: CardGame, query: String) async -> Result<CardSearchResult, SearchPricingErrors>
    func ownedPrices(game: CardGame?) async -> Result<[OwnedCardPrice], OwnedPricesErrors>
}

public struct TCGPricingClientImpl: TCGPricingClient {
    private let client: Client

    init(client: Client) {
        self.client = client
    }

    public func search(game: CardGame, query: String) async -> Result<CardSearchResult, SearchPricingErrors> {
        let response: Operations.GetAppApiPricingSearch.Output
        do {
            response = try await client.getAppApiPricingSearch(
                query: .init(game: Self.makeSearchGame(game), query: query)
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
        case .notFound:
            return .failure(.unauthorized)
        case .serviceUnavailable:
            return .failure(.unavailable)
        case .undocumented(let status, let payload):
            return .failure(.unknown(status: status, payload: payload, cause: nil))
        }
    }

    public func ownedPrices(game: CardGame?) async -> Result<[OwnedCardPrice], OwnedPricesErrors> {
        let response: Operations.GetAppApiPricingOwned.Output
        do {
            response = try await client.getAppApiPricingOwned(
                query: .init(game: game.map(Self.makeOwnedGame))
            )
        } catch {
            return .failure(.unknown(status: 503, payload: nil, cause: error))
        }

        switch response {
        case .ok(let response):
            do {
                return .success(try response.body.json.prices.map(Self.makeOwnedPrice))
            } catch {
                return .failure(.unknown(status: 503, payload: nil, cause: error))
            }
        case .badRequest(let response):
            return .failure(
                .badRequest(validations: TCGClientValidationErrorParser.parseIssues(from: try? response.body.json))
            )
        case .notFound:
            return .failure(.unauthorized)
        case .serviceUnavailable:
            return .failure(.unavailable)
        case .undocumented(let status, let payload):
            return .failure(.unknown(status: status, payload: payload, cause: nil))
        }
    }

    private static func makeSearchResult(_ result: Components.Schemas.PricingSearchResponse) -> CardSearchResult {
        CardSearchResult(
            query: result.query,
            normalizedQuery: result.normalizedQuery,
            game: makeGame(result.game),
            status: makeStatus(result.status),
            matches: result.matches.map(makePricedCard)
        )
    }

    private static func makeOwnedPrice(_ price: Components.Schemas.OwnedCardPrice) -> OwnedCardPrice {
        OwnedCardPrice(
            cardId: price.cardId,
            status: makeOwnedStatus(price.status),
            price: price.price.map { makePricedCard($0.value1) }
        )
    }

    private static func makePricedCard(_ card: Components.Schemas.PricedCard) -> PricedCard {
        PricedCard(
            tcggoCardId: card.tcggoCardId,
            game: makeGame(card.game),
            name: card.name,
            cardNumber: card.cardNumber,
            rarity: card.rarity,
            imageURL: card.imageUrl,
            headline: card.headline.map {
                PriceHeadline(amount: $0.amount, currency: $0.currency, metric: $0.metric.rawValue)
            },
            cardmarket: card.cardmarket.map {
                CardMarketPrice(
                    currency: $0.currency,
                    lowestNearMint: $0.lowestNearMint,
                    average7d: $0.average7d,
                    average30d: $0.average30d,
                    trend: $0.trend.map(makeTrend)
                )
            },
            tcgplayer: card.tcgplayer.map {
                TCGPlayerPrice(currency: $0.currency, marketPrice: $0.marketPrice, midPrice: $0.midPrice)
            },
            pricedOn: card.pricedOn,
            fetchedAt: card.fetchedAt
        )
    }

    private static func makeSearchGame(
        _ game: CardGame
    ) -> Operations.GetAppApiPricingSearch.Input.Query.GamePayload {
        switch game {
        case .onePiece: .onePiece
        case .pokemon: .pokemon
        }
    }

    private static func makeOwnedGame(
        _ game: CardGame
    ) -> Operations.GetAppApiPricingOwned.Input.Query.GamePayload {
        switch game {
        case .onePiece: .onePiece
        case .pokemon: .pokemon
        }
    }

    private static func makeGame(_ game: Components.Schemas.PricingSearchResponse.GamePayload) -> CardGame {
        switch game {
        case .onePiece: .onePiece
        case .pokemon: .pokemon
        }
    }

    private static func makeGame(_ game: Components.Schemas.PricedCard.GamePayload) -> CardGame {
        switch game {
        case .onePiece: .onePiece
        case .pokemon: .pokemon
        }
    }

    private static func makeStatus(_ status: Components.Schemas.PricingSearchResponse.StatusPayload) -> CardSearchStatus
    {
        switch status {
        case .ok: .ok
        case .noResults: .noResults
        }
    }

    private static func makeOwnedStatus(
        _ status: Components.Schemas.OwnedCardPrice.StatusPayload
    ) -> OwnedCardPriceStatus {
        switch status {
        case .priced: .priced
        case .noMatch: .noMatch
        case .noPrice: .noPrice
        }
    }

    private static func makeTrend(_ trend: Components.Schemas.CardMarketPrice.TrendPayload) -> PriceTrend {
        switch trend {
        case .up: .up
        case .down: .down
        case .flat: .flat
        }
    }
}
