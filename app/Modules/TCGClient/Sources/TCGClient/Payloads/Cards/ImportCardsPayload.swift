import Foundation

public struct ImportCardsPayload: Codable, Equatable, Sendable {
    public let cards: [ImportCardPayload]

    public init(cards: [ImportCardPayload]) {
        self.cards = cards
    }
}

public struct ImportCardPayload: Codable, Equatable, Sendable {
    public let id: UUID
    public var collectionID: UUID?
    public let game: ClientCardGame
    public let name: String
    public let setName: String
    public let cardNumber: String
    public let notes: String?
    public let createdAt: Date
    public let updatedAt: Date
    public let purchases: [ImportPurchasePayload]

    public init(card: Card) {
        self.init(
            id: card.id,
            collectionID: card.collectionID,
            game: card.game,
            name: card.name,
            setName: card.setName,
            cardNumber: card.cardNumber,
            notes: card.notes,
            createdAt: card.createdAt,
            updatedAt: card.updatedAt,
            purchases: card.purchases.map(ImportPurchasePayload.init)
        )
    }

    init(
        id: UUID,
        collectionID: UUID?,
        game: ClientCardGame,
        name: String,
        setName: String,
        cardNumber: String,
        notes: String?,
        createdAt: Date,
        updatedAt: Date,
        purchases: [ImportPurchasePayload]
    ) {
        self.id = id
        self.collectionID = collectionID
        self.game = game
        self.name = name
        self.setName = setName
        self.cardNumber = cardNumber
        self.notes = notes
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.purchases = purchases
    }

    private enum CodingKeys: String, CodingKey {
        case collectionID = "collection_id"
        case id, game, name, notes, purchases
        case setName = "set_name"
        case cardNumber = "card_number"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

public struct ImportPurchasePayload: Codable, Equatable, Sendable {
    public let id: UUID
    public let condition: CardCondition
    public let quantity: Int
    public let purchasePrice: String?
    public let currency: Currency?
    public let automaticPriceDate: String?

    public init(purchase: CardPurchase) {
        self.init(
            id: purchase.id ?? UUID(),
            condition: purchase.condition,
            quantity: purchase.quantity,
            purchasePrice: purchase.purchasePrice.map { NSDecimalNumber(decimal: $0).stringValue },
            currency: purchase.currency,
            automaticPriceDate: purchase.automaticPriceDate
        )
    }

    init(
        id: UUID,
        condition: CardCondition,
        quantity: Int,
        purchasePrice: String?,
        currency: Currency?,
        automaticPriceDate: String?
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

public struct ImportCardsResult: Codable, Equatable, Sendable {
    public let allocationAdjustments: Int?
    public let importedCount: Int
    public let updatedCount: Int
    public let skippedCount: Int

    public init(importedCount: Int, updatedCount: Int, skippedCount: Int, allocationAdjustments: Int?) {
        self.allocationAdjustments = allocationAdjustments
        self.importedCount = importedCount
        self.updatedCount = updatedCount
        self.skippedCount = skippedCount
    }

    private enum CodingKeys: String, CodingKey {
        case allocationAdjustments = "allocation_adjustments"
        case importedCount = "imported_count"
        case updatedCount = "updated_count"
        case skippedCount = "skipped_count"
    }
}
