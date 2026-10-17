//
//  PricedCardMapper.swift
//  TCGClient
//

import Foundation

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
            setName: card.setName,
            rarity: card.rarity,
            imageURL: card.imageUrl.flatMap(URL.init(string:)),
            headline: card.headline.map(makeHeadline),
            market: card.market.map(makeMarket),
            display: card.display.map {
                PricedCardDisplay(
                    preferredCurrency: makeCurrency($0.preferredCurrency),
                    headline: $0.headline.map(makeHeadline),
                    market: $0.market.map(makeMarket),
                    conversionUnavailable: $0.conversionUnavailable
                )
            },
            pricedOn: card.pricedOn,
            fetchedAt: card.fetchedAt
        )
    }

    private static func makeHeadline(_ price: Components.Schemas.PriceHeadline) -> PriceHeadline {
        PriceHeadline(amount: price.amount, currency: makeCurrency(price.currency), metric: makeMetric(price.metric))
    }

    private static func makeMarket(_ market: Components.Schemas.MarketPrice) -> MarketPrice {
        MarketPrice(
            condition: .nearMint,
            currency: makeCurrency(market.currency),
            low: market.low,
            market: market.market,
            trend7d: market.trend7d.map(makeMovement),
            trend30d: market.trend30d.map(makeMovement)
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
        case .eur: .eur
        case .usd: .usd
        case .jpy: .jpy
        case .czk: .czk
        case .dkk: .dkk
        case .gbp: .gbp
        case .huf: .huf
        case .pln: .pln
        case .ron: .ron
        case .sek: .sek
        case .chf: .chf
        case .isk: .isk
        case .nok: .nok
        case ._try: .try
        case .aud: .aud
        case .brl: .brl
        case .cad: .cad
        case .cny: .cny
        case .hkd: .hkd
        case .idr: .idr
        case .ils: .ils
        case .inr: .inr
        case .krw: .krw
        case .mxn: .mxn
        case .myr: .myr
        case .nzd: .nzd
        case .php: .php
        case .sgd: .sgd
        case .thb: .thb
        case .zar: .zar
        }
    }

    static func generatedCurrency(_ currency: Currency) -> Components.Schemas.Currency {
        switch currency {
        case .eur: .eur
        case .usd: .usd
        case .jpy: .jpy
        case .czk: .czk
        case .dkk: .dkk
        case .gbp: .gbp
        case .huf: .huf
        case .pln: .pln
        case .ron: .ron
        case .sek: .sek
        case .chf: .chf
        case .isk: .isk
        case .nok: .nok
        case .try: ._try
        case .aud: .aud
        case .brl: .brl
        case .cad: .cad
        case .cny: .cny
        case .hkd: .hkd
        case .idr: .idr
        case .ils: .ils
        case .inr: .inr
        case .krw: .krw
        case .mxn: .mxn
        case .myr: .myr
        case .nzd: .nzd
        case .php: .php
        case .sgd: .sgd
        case .thb: .thb
        case .zar: .zar
        }
    }

    static func makeMetric(_ metric: Components.Schemas.PriceHeadline.MetricPayload) -> PriceMetric {
        switch metric {
        case .lowestNearMint: .lowestNearMint
        }
    }
}
