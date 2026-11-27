//
//  PricedCardMapper.swift
//  TCGClient
//

import Foundation

enum PricedCardMapper {
    static func makeOwnedPrice(_ apiPrice: Components.Schemas.OwnedCardPrice) -> Result<OwnedCardPrice, UUIDCodingError>
    {
        UUIDCoding.decode(apiPrice.cardId)
            .map { cardID in
                OwnedCardPrice(
                    cardId: cardID,
                    status: makeOwnedStatus(apiPrice.status),
                    price: apiPrice.pricedCard.map(makePricedCard),
                    valuation: apiPrice.valuation.map {
                        OwnedValuation(
                            amount: $0.amount,
                            currency: makeCurrency($0.currency),
                            estimated: $0.estimated,
                            conversionUnavailable: $0.conversionUnavailable,
                            purchasePriceChangePercent: $0.purchasePriceChangePercent
                        )
                    }
                )
            }
    }

    static func makePricedCard(_ card: Components.Schemas.PricedCard) -> PricedCard {
        var mapped = PricedCard(
            id: card.id,
            printingKey: card.printingKey,
            isWishlisted: card.isWishlisted,
            game: makeGame(card.game),
            name: card.name,
            cardNumber: card.cardNumber,
            setName: card.setName,
            rarity: card.rarity,
            illustrator: card.illustrator,
            englishSearchAlias: card.englishSearchAlias,
            variantName: card.variantName,
            imageURL: card.imageUrl.flatMap(URL.init(string:)),
            headline: card.headline.map(makeHeadline),
            market: card.market.map(makeMarket),
            conditionPrices: card.conditionPrices?.map(makeConditionPrice),
            conditionValues: card.conditionValues?.map(makeConditionValue),
            gradedPrices: card.gradedPrices?.map(makeGradedPrice),
            display: card.display.map {
                PricedCardDisplay(
                    preferredCurrency: makeCurrency($0.preferredCurrency),
                    headline: $0.headline.map(makeHeadline),
                    market: $0.market.map(makeMarket),
                    conditionPrices: $0.conditionPrices?.map(makeConditionPrice),
                    conditionValues: $0.conditionValues?.map(makeConditionValue),
                    gradedPrices: $0.gradedPrices?.map(makeGradedPrice),
                    conversionUnavailable: $0.conversionUnavailable
                )
            },
            pricedOn: card.pricedOn,
            fetchedAt: card.fetchedAt
        )
        mapped.catalogSets = card.catalogSets?.map { CatalogSetReference(id: $0.id, name: $0.name) }
        return mapped
    }

    private static func makeHeadline(_ price: Components.Schemas.PriceHeadline) -> PriceHeadline {
        PriceHeadline(amount: price.amount, currency: makeCurrency(price.currency), metric: makeMetric(price.metric))
    }

    private static func makeGradedPrice(_ price: Components.Schemas.GradedPrice) -> GradedPrice {
        GradedPrice(
            company: price.company,
            grade: price.grade,
            currency: makeCurrency(price.currency),
            low: price.low,
            market: price.market,
            population: price.population
        )
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

    private static func makeConditionPrice(_ price: Components.Schemas.ConditionPrice) -> MarketPrice {
        let condition: CardCondition =
            switch price.condition {
            case .nearMint: .nearMint
            case .excellent: .excellent
            case .good: .good
            case .played: .played
            case .damaged: .damaged
            }
        return MarketPrice(
            condition: condition,
            currency: makeCurrency(price.currency),
            low: price.low,
            market: price.market,
            trend7d: price.trend7d.map(makeMovement),
            trend30d: price.trend30d.map(makeMovement)
        )
    }

    private static func makeConditionValue(_ value: Components.Schemas.ConditionValue) -> ConditionValue {
        let condition: CardCondition =
            switch value.condition {
            case .mint: .mint
            case .nearMint: .nearMint
            case .excellent: .excellent
            case .good: .good
            case .played: .played
            case .damaged: .damaged
            }
        let basis: ConditionValue.Basis =
            switch value.basis {
            case .market: .market
            case .low: .low
            case .interpolated: .interpolated
            case .adjusted: .adjusted
            }
        return ConditionValue(
            condition: condition,
            currency: makeCurrency(value.currency),
            amount: value.amount,
            basis: basis,
            conversionUnavailable: value.conversionUnavailable
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

    static func makeCurrency(_ currency: Components.Schemas.NullableCurrency) -> Currency? {
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
        case ._empty_: nil
        }
    }

    static func generatedNullableCurrency(
        _ currency: Currency
    ) -> Components.Schemas.NullableCurrency {
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
