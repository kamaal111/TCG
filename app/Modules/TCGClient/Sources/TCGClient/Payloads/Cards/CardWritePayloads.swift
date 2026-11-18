import Foundation

public struct CreateCardPayload: Codable, Equatable, Sendable {
    public let pricedCardID: UUID
    public let collectionID: UUID?
    public let notes: String?
    public let purchases: [CardPurchase]

    public init(pricedCardID: UUID, ownership: UpdateCardPayload) {
        self.pricedCardID = pricedCardID
        collectionID = ownership.collectionID
        notes = ownership.notes
        purchases = ownership.purchases
    }

    private enum CodingKeys: String, CodingKey {
        case pricedCardID = "priced_card_id"
        case collectionID = "collection_id"
        case notes, purchases
    }
}

public struct UpdateCardPayload: Codable, Equatable, Sendable {
    public let collectionID: UUID?
    public let notes: String?
    public let purchases: [CardPurchase]

    public init(notes: String?, purchases: [CardPurchase], collectionID: UUID?) {
        self.collectionID = collectionID
        self.notes = notes
        self.purchases = purchases
    }

    private enum CodingKeys: String, CodingKey {
        case collectionID = "collection_id"
        case notes, purchases
    }
}
