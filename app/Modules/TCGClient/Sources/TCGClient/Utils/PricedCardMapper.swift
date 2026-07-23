//
//  PricedCardMapper.swift
//  TCGClient
//

enum PricedCardMapper {
    static func makeOwnedPrice(_ apiPrice: Components.Schemas.OwnedCardPrice) -> OwnedCardPrice {
        OwnedCardPrice(
            cardId: apiPrice.cardId,
            status: makeOwnedStatus(apiPrice.status),
            price: apiPrice.pricedCard.map(makePricedCard)
        )
    }

    static func makePricedCard(_ card: Components.Schemas.PricedCard) -> PricedCard {
        PricedCard(
            id: card.id,
            game: makeGame(card.game),
            name: card.name,
            cardNumber: card.cardNumber,
            rarity: card.rarity,
            imageURL: card.imageUrl,
            headline: card.headline.map {
                PriceHeadline(
                    amount: $0.amount, currency: makeCurrency($0.currency), metric: makeMetric($0.metric))
            },
            market: card.market.map {
                MarketPrice(
                    condition: .nearMint,
                    currency: makeCurrency($0.currency),
                    low: $0.low,
                    market: $0.market,
                    trend7d: $0.trend7d.map(makeMovement),
                    trend30d: $0.trend30d.map(makeMovement)
                )
            },
            pricedOn: card.pricedOn,
            fetchedAt: card.fetchedAt
        )
    }

    static func makeGame(_ game: Components.Schemas.PricedCard.GamePayload) -> ClientCardGame {
        switch game {
        case .onePiece: .onePiece
        case .pokemon: .pokemon
        }
    }

    static func makeOwnedStatus(
        _ status: Components.Schemas.OwnedCardPrice.StatusPayload
    ) -> OwnedCardPriceStatus {
        switch status {
        case .priced: .priced
        case .noMatch: .noMatch
        case .noPrice: .noPrice
        case .unavailable: .unavailable
        }
    }

    static func makeMovement(_ movement: Components.Schemas.PriceMovement) -> PriceMovement {
        PriceMovement(priceChange: movement.priceChange, percentChange: movement.percentChange)
    }

    static func makeCurrency(_ currency: Components.Schemas.Currency) -> Currency {
        switch currency {
        case .jpy: .jpy
        case .usd: .usd
        }
    }

    static func makeMetric(_ metric: Components.Schemas.PriceHeadline.MetricPayload) -> PriceMetric {
        switch metric {
        case .lowestNearMint: .lowestNearMint
        }
    }
}
