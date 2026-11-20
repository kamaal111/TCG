//
//  CardWithPrice.swift
//  TCGClient
//

import Foundation

public struct CardWithPrice: Codable, Hashable, Sendable {
    public let card: Card
    public let price: OwnedCardPrice?
    public let imageURL: URL?

    public init(card: Card, price: OwnedCardPrice?, imageURL: URL?) {
        self.card = card
        self.price = price
        self.imageURL = imageURL ?? price?.price?.imageURL
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let cachedPrice = try container.decodeIfPresent(OwnedCardPrice.self, forKey: .price)
        self.init(
            card: try container.decode(Card.self, forKey: .card),
            price: cachedPrice?.status == .pending ? nil : cachedPrice,
            imageURL: try container.decodeIfPresent(URL.self, forKey: .imageURL)
        )
    }

    private enum CodingKeys: String, CodingKey {
        case card
        case price
        case imageURL = "artworkURL"
    }
}
