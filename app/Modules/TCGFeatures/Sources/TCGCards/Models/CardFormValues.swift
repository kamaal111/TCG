//
//  CardFormValues.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/20/26.
//

import Foundation
import KamaalExtensions
import TCGClient
import TCGUtils

struct CardFormValues: Equatable {
    var collectionID: UUID?
    let game: ClientCardGame
    let name: String
    let setName: String
    let cardNumber: String
    var notes: String
    var batches: [PurchaseBatchFormValue] = []
    var preferredCurrency: Currency?
    var exchangeRates: ExchangeRates?
    var conditionValues: [ConditionValue]?
    var defaultMarketPrice: Decimal?
    var defaultMarketCurrency: Currency?
    var marketPricedOn: Date?
    var illustrator: String?
    var englishSearchAlias: String?
    var variantName: String?

    var quantities: [CardCondition: Int] {
        get {
            CardConditionQuantity.totals(
                batches.map { CardConditionQuantity(condition: $0.condition, quantity: $0.quantity) }
            )
        }
        set {
            batches = CardCondition.allCases.compactMap { condition in
                guard let quantity = newValue[condition] else { return nil }
                var batch = batches.first { $0.condition == condition } ?? newBatch(condition: condition)
                batch.quantity = quantity
                return batch
            }
        }
    }

    func newBatch(condition: CardCondition) -> PurchaseBatchFormValue {
        applyingMarketDefault(
            to: PurchaseBatchFormValue(condition: condition, quantity: 1, priceText: "", currency: .fallback)
        )
    }

    func applyingMarketDefault(to batch: PurchaseBatchFormValue) -> PurchaseBatchFormValue {
        let value = conditionValues?.first { $0.condition == batch.condition }
        let price = conditionValues == nil ? defaultMarketPrice : value.flatMap { marketDecimal($0.amount) }
        let source = conditionValues == nil ? defaultMarketCurrency : value?.currency
        let target = batch.currencyWasSelected ? batch.currency : preferredCurrency ?? source ?? .fallback
        let converted: Decimal?
        if let price, let source {
            converted = source == target ? price : exchangeRates?.convert(price, from: source, to: target)
        } else {
            converted = nil
        }
        var updated = batch
        updated.applyDefaultPrice(converted, currency: target, pricedOn: marketPricedOn)
        return updated
    }

    init(
        game: ClientCardGame,
        name: String,
        setName: String,
        cardNumber: String,
        notes: String,
        quantities: [CardCondition: Int]
    ) {
        self.game = game
        self.name = name
        self.setName = setName
        self.cardNumber = cardNumber
        self.notes = notes
        self.quantities = quantities
    }

    init(card: Card) {
        collectionID = card.collectionID
        game = card.game
        name = card.name
        setName = card.setName
        cardNumber = card.cardNumber
        notes = card.notes ?? ""
        illustrator = card.illustrator
        englishSearchAlias = card.englishSearchAlias
        batches = card.purchases.map { PurchaseBatchFormValue(batch: $0) }
    }

    init(pricedCard: PricedCard) {
        game = pricedCard.game
        name = pricedCard.name
        setName = pricedCard.setName ?? ""
        cardNumber = pricedCard.cardNumber
        notes = ""
        quantities = [:]
        illustrator = pricedCard.illustrator
        variantName = pricedCard.variantName
        updateMarketDefault(pricedCard)
    }

    mutating func updateMarketDefault(_ pricedCard: PricedCard) {
        conditionValues = pricedCard.conditionValues
        defaultMarketPrice = pricedCard.market?.market.flatMap(marketDecimal)
        defaultMarketCurrency = pricedCard.market?.currency
        marketPricedOn = pricedCard.pricedOn
        illustrator = pricedCard.illustrator ?? illustrator
        englishSearchAlias = pricedCard.englishSearchAlias ?? englishSearchAlias
        variantName = pricedCard.variantName ?? variantName
    }

    private func marketDecimal(_ amount: Double) -> Decimal? {
        Decimal(string: String(format: "%.6f", amount), locale: TCGLocales.decimal)
    }

    var payload: UpdateCardPayload {
        UpdateCardPayload(
            notes: trimmedNotes.isEmpty ? nil : trimmedNotes,
            purchases: batches.filter { $0.quantity > 0 }.map(\.purchase),
            collectionID: collectionID
        )
    }

    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.collectionID == rhs.collectionID && lhs.game == rhs.game && lhs.name == rhs.name
            && lhs.setName == rhs.setName
            && lhs.cardNumber == rhs.cardNumber && lhs.notes == rhs.notes && lhs.batches == rhs.batches
    }

    private var trimmedNotes: String { notes.trimmingByWhitespacesAndNewLines }
}

struct PurchaseBatchFormValue: Equatable, Identifiable {
    let id: UUID
    let persistedID: UUID?
    var condition: CardCondition
    var quantity: Int
    var priceText: String
    var currency: Currency
    var automaticPriceDate: String?
    var priceWasEdited = false
    var currencyWasSelected = false

    init(condition: CardCondition, quantity: Int, priceText: String, currency: Currency) {
        id = UUID()
        persistedID = nil
        self.condition = condition
        self.quantity = quantity
        self.priceText = priceText
        self.currency = currency
    }

    init(batch: CardPurchase) {
        id = UUID()
        persistedID = batch.id
        condition = batch.condition
        quantity = batch.quantity
        priceText = Self.priceText(for: batch.purchasePrice)
        currency = batch.currency ?? .fallback
    }

    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.persistedID == rhs.persistedID && lhs.condition == rhs.condition && lhs.quantity == rhs.quantity
            && lhs.priceText == rhs.priceText && lhs.currency == rhs.currency
    }

    var purchase: CardPurchase {
        let amount = price
        return CardPurchase(
            id: persistedID,
            condition: condition,
            quantity: quantity,
            purchasePrice: amount,
            currency: amount == nil ? nil : currency,
            automaticPriceDate: amount == nil || priceWasEdited ? nil : automaticPriceDate,
            displayPrice: nil
        )
    }

    mutating func applyDefaultPrice(_ price: Decimal?, currency: Currency?, pricedOn: Date?) {
        guard persistedID == nil else { return }
        guard !priceWasEdited else { return }
        priceText = Self.priceText(for: price)
        automaticPriceDate =
            price == nil
            ? nil
            : pricedOn?.formatted(.iso8601.year().month().day().dateSeparator(.dash))
        if !currencyWasSelected { self.currency = currency ?? .fallback }
    }

    private static func priceText(for price: Decimal?) -> String {
        price.map {
            $0.formatted(
                .number.precision(.fractionLength(0...6))
                    .grouping(.never)
                    .rounded(rule: .toNearestOrAwayFromZero)
                    .locale(TCGLocales.decimal)
            )
        } ?? ""
    }

    var price: Decimal? {
        let normalized = priceText.trimmingByWhitespacesAndNewLines
            .replacingOccurrences(of: TCGLocales.current.decimalSeparator ?? ".", with: ".")
        guard normalized.range(of: #"^(?:0|[1-9]\d{0,13})(?:\.\d{1,6})?$"#, options: .regularExpression) != nil else {
            return nil
        }
        return Decimal(string: normalized, locale: TCGLocales.decimal)
    }
}
