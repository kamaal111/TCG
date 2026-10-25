import Foundation

public struct PurchaseDisplayPrice: Codable, Hashable, Sendable {
    public let amount: Decimal
    public let currency: Currency
    public let conversionUnavailable: Bool

    public init(amount: Decimal, currency: Currency, conversionUnavailable: Bool) {
        self.amount = amount
        self.currency = currency
        self.conversionUnavailable = conversionUnavailable
    }

    private enum CodingKeys: String, CodingKey {
        case amount, currency
        case conversionUnavailable = "conversion_unavailable"
    }
}

/// A group of copies bought at one price per card. A nil price is awaiting market backfill.
public struct CardPurchase: Codable, Hashable, Sendable {
    public let id: UUID?
    public let condition: CardCondition
    public let quantity: Int
    public let purchasePrice: Decimal?
    public let currency: Currency?
    public let automaticPriceDate: String?
    public let displayPrice: PurchaseDisplayPrice?

    public init(
        id: UUID? = nil,
        condition: CardCondition,
        quantity: Int,
        purchasePrice: Decimal? = nil,
        currency: Currency? = nil,
        automaticPriceDate: String? = nil,
        displayPrice: PurchaseDisplayPrice? = nil
    ) {
        self.id = id
        self.condition = condition
        self.quantity = quantity
        self.purchasePrice = purchasePrice
        self.currency = currency
        self.automaticPriceDate = automaticPriceDate
        self.displayPrice = displayPrice
    }

    private enum CodingKeys: String, CodingKey {
        case id, condition, quantity, currency
        case purchasePrice = "purchase_price"
        case automaticPriceDate = "automatic_price_date"
        case displayPrice = "display_price"
    }
}
