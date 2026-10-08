import Foundation

/// A group of copies bought at one price per card. A nil price is awaiting market backfill.
public struct CardPurchase: Codable, Hashable, Sendable {
    public let id: String?
    public let condition: CardCondition
    public let quantity: Int
    public let purchasePrice: Decimal?
    public let currency: Currency?
    public let automaticPriceDate: String?

    public init(
        id: String? = nil,
        condition: CardCondition,
        quantity: Int,
        purchasePrice: Decimal? = nil,
        currency: Currency? = nil,
        automaticPriceDate: String? = nil
    ) {
        self.id = id
        self.condition = condition
        self.quantity = quantity
        self.purchasePrice = purchasePrice
        self.currency = currency
        self.automaticPriceDate = automaticPriceDate
    }

    private enum CodingKeys: String, CodingKey {
        case id, condition, quantity, currency
        case purchasePrice = "purchase_price"
        case automaticPriceDate = "automatic_price_date"
    }
}
