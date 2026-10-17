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
            headline: card.headline.map {
                PriceHeadline(
                    amount: $0.amount,
                    currency: makeCurrency($0.currency),
                    metric: makeMetric($0.metric)
                )
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
