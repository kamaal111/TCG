//
//  CardFormValues.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/20/26.
//

import Foundation
import TCGClient
import TCGUtils

struct CardFormValues: Equatable {
    var game: ClientCardGame
    var name: String
    var setName: String
    var cardNumber: String
    var notes: String
    var batches: [PurchaseBatchFormValue] = []
    var defaultMarketPrice: Decimal?
    var defaultMarketCurrency: Currency?
    var marketPricedOn: Date?
    var pricingCardID: String?

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
        var batch = PurchaseBatchFormValue(condition: condition, quantity: 1)
        batch.applyDefaultPrice(defaultMarketPrice, currency: defaultMarketCurrency)
        return batch
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
        game = card.game
        name = card.name
        setName = card.setName
        cardNumber = card.cardNumber
        notes = card.notes ?? ""
        batches = card.purchases.map { PurchaseBatchFormValue(batch: $0) }
    }

    init(pricedCard: PricedCard) {
        game = pricedCard.game
        name = pricedCard.name
        setName = pricedCard.setName ?? ""
        cardNumber = pricedCard.cardNumber
        notes = ""
        quantities = [:]
        updateMarketDefault(pricedCard)
    }

    mutating func updateMarketDefault(_ pricedCard: PricedCard) {
        defaultMarketPrice = pricedCard.market?.market.flatMap {
            Decimal(string: String(format: "%.6f", $0), locale: TCGLocales.decimal)
        }
        defaultMarketCurrency = pricedCard.market?.currency
        marketPricedOn = pricedCard.pricedOn
        pricingCardID = pricedCard.id
    }

    var payload: UpsertCardPayload {
        return UpsertCardPayload(
            game: game,
            name: name.trimmingCharacters(in: .whitespacesAndNewlines),
            setName: setName.trimmingCharacters(in: .whitespacesAndNewlines),
            cardNumber: cardNumber.trimmingCharacters(in: .whitespacesAndNewlines),
            notes: trimmedNotes.isEmpty ? nil : trimmedNotes,
            purchases: batches.filter { $0.quantity > 0 }.map(\.purchase)
        )
    }

    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.game == rhs.game && lhs.name == rhs.name && lhs.setName == rhs.setName
            && lhs.cardNumber == rhs.cardNumber && lhs.notes == rhs.notes && lhs.batches == rhs.batches
    }

    private var trimmedNotes: String { notes.trimmingCharacters(in: .whitespacesAndNewlines) }
}

struct PurchaseBatchFormValue: Equatable, Identifiable {
    let id: UUID
    let persistedID: String?
    var condition: CardCondition
    var quantity: Int
    var priceText: String
    var currency: Currency
    var priceWasEdited = false

    init(condition: CardCondition, quantity: Int, priceText: String = "", currency: Currency = .usd) {
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
        currency = batch.currency ?? .usd
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
            currency: amount == nil ? nil : currency
        )
    }

    mutating func applyDefaultPrice(_ price: Decimal?, currency: Currency?) {
        guard persistedID == nil else { return }
        guard !priceWasEdited else { return }
        priceText = Self.priceText(for: price)
        self.currency = currency ?? .usd
    }

    private static func priceText(for price: Decimal?) -> String {
        price.map { NSDecimalNumber(decimal: $0).stringValue } ?? ""
    }

    var price: Decimal? {
        let normalized = priceText.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: TCGLocales.current.decimalSeparator ?? ".", with: ".")
        guard normalized.range(of: #"^(?:0|[1-9]\d{0,13})(?:\.\d{1,6})?$"#, options: .regularExpression) != nil else {
            return nil
        }
        return Decimal(string: normalized, locale: TCGLocales.decimal)
    }
}
