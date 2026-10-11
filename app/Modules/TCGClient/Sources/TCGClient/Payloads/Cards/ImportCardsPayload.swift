import Foundation

public struct ImportCardsPayload: Codable, Equatable, Sendable {
    public let cards: [ImportCardPayload]

    public init(cards: [ImportCardPayload]) {
        self.cards = cards
    }
}

public struct ImportCardPayload: Codable, Equatable, Sendable {
    public let id: String
    public let game: ClientCardGame
    public let name: String
    public let setName: String
    public let cardNumber: String
    public let notes: String?
    public let createdAt: Date
    public let updatedAt: Date
    public let purchases: [ImportPurchasePayload]

    public init(card: Card) {
        id = card.id
        game = card.game
        name = card.name
        setName = card.setName
        cardNumber = card.cardNumber
        notes = card.notes
        createdAt = card.createdAt
        updatedAt = card.updatedAt
        purchases = card.purchases.map(ImportPurchasePayload.init)
    }

    private enum CodingKeys: String, CodingKey {
        case id, game, name, notes, purchases
        case setName = "set_name"
        case cardNumber = "card_number"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

public struct ImportPurchasePayload: Codable, Equatable, Sendable {
    public let id: String
    public let condition: CardCondition
    public let quantity: Int
    public let purchasePrice: String?
    public let currency: Currency?
    public let automaticPriceDate: String?

    public init(purchase: CardPurchase) {
        id = purchase.id ?? UUID().uuidString.lowercased()
        condition = purchase.condition
        quantity = purchase.quantity
        purchasePrice = purchase.purchasePrice.map { NSDecimalNumber(decimal: $0).stringValue }
        currency = purchase.currency
        automaticPriceDate = purchase.automaticPriceDate
    }

    private enum CodingKeys: String, CodingKey {
        case id, condition, quantity, currency
        case purchasePrice = "purchase_price"
        case automaticPriceDate = "automatic_price_date"
    }
}

public struct ImportCardsResult: Codable, Equatable, Sendable {
    public let importedCount: Int
    public let updatedCount: Int
    public let skippedCount: Int

    public init(importedCount: Int, updatedCount: Int, skippedCount: Int) {
        self.importedCount = importedCount
        self.updatedCount = updatedCount
        self.skippedCount = skippedCount
    }

    private enum CodingKeys: String, CodingKey {
        case importedCount = "imported_count"
        case updatedCount = "updated_count"
        case skippedCount = "skipped_count"
    }
}
