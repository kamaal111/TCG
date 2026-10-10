public struct DeleteCardsPayload: Codable, Equatable, Sendable {
    public let cardIDs: [String]

    public init(cardIDs: [String]) {
        self.cardIDs = cardIDs
    }

    private enum CodingKeys: String, CodingKey {
        case cardIDs = "card_ids"
    }
}
