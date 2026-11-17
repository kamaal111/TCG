public struct SaveWishlistPrinting: Codable, Equatable, Sendable {
    public let pricedCardID: String

    public init(pricedCardID: String) { self.pricedCardID = pricedCardID }

    private enum CodingKeys: String, CodingKey {
        case pricedCardID = "priced_card_id"
    }
}
