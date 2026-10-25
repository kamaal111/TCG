import Foundation

public struct DeleteCardsPayload: Codable, Equatable, Sendable {
    public let cardIDs: [UUID]

    public init(cardIDs: [UUID]) {
        self.cardIDs = cardIDs
    }

    private enum CodingKeys: String, CodingKey {
        case cardIDs = "card_ids"
    }
}
