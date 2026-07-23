//
//  CardPrice.swift
//  TCGClient
//

import Foundation

public enum PriceTrend: String, Codable, Hashable, Sendable {
    case up
    case down
    case flat
}

public struct PriceHeadline: Codable, Hashable, Sendable {
    public let amount: Double
    public let currency: String
    public let metric: String

    public init(amount: Double, currency: String, metric: String = "lowest_near_mint") {
        self.amount = amount
        self.currency = currency
        self.metric = metric
    }
}

public struct CardMarketPrice: Codable, Hashable, Sendable {
    public let currency: String
    public let lowestNearMint: Double?
    public let average7d: Double?
    public let average30d: Double?
    public let trend: PriceTrend?

    public init(
        currency: String,
        lowestNearMint: Double? = nil,
        average7d: Double? = nil,
        average30d: Double? = nil,
        trend: PriceTrend? = nil
    ) {
        self.currency = currency
        self.lowestNearMint = lowestNearMint
        self.average7d = average7d
        self.average30d = average30d
        self.trend = trend
    }

    private enum CodingKeys: String, CodingKey {
        case currency
        case trend
        case lowestNearMint = "lowest_near_mint"
        case average7d = "average_7d"
        case average30d = "average_30d"
    }
}

public struct TCGPlayerPrice: Codable, Hashable, Sendable {
    public let currency: String
    public let marketPrice: Double?
    public let midPrice: Double?

    public init(currency: String, marketPrice: Double? = nil, midPrice: Double? = nil) {
        self.currency = currency
        self.marketPrice = marketPrice
        self.midPrice = midPrice
    }

    private enum CodingKeys: String, CodingKey {
        case currency
        case marketPrice = "market_price"
        case midPrice = "mid_price"
    }
}

public struct PricedCard: Codable, Hashable, Identifiable, Sendable {
    public let tcggoCardId: String
    public let game: CardGame
    public let name: String
    public let cardNumber: String
    public let rarity: String?
    public let imageURL: String?
    public let headline: PriceHeadline?
    public let cardmarket: CardMarketPrice?
    public let tcgplayer: TCGPlayerPrice?
    public let pricedOn: String
    public let fetchedAt: Date

    public var id: String { tcggoCardId }

    public init(
        tcggoCardId: String,
        game: CardGame,
        name: String,
        cardNumber: String,
        rarity: String? = nil,
        imageURL: String? = nil,
        headline: PriceHeadline? = nil,
        cardmarket: CardMarketPrice? = nil,
        tcgplayer: TCGPlayerPrice? = nil,
        pricedOn: String,
        fetchedAt: Date
    ) {
        self.tcggoCardId = tcggoCardId
        self.game = game
        self.name = name
        self.cardNumber = cardNumber
        self.rarity = rarity
        self.imageURL = imageURL
        self.headline = headline
        self.cardmarket = cardmarket
        self.tcgplayer = tcgplayer
        self.pricedOn = pricedOn
        self.fetchedAt = fetchedAt
    }

    private enum CodingKeys: String, CodingKey {
        case game
        case name
        case rarity
        case headline
        case cardmarket
        case tcgplayer
        case tcggoCardId = "tcggo_card_id"
        case cardNumber = "card_number"
        case imageURL = "image_url"
        case pricedOn = "priced_on"
        case fetchedAt = "fetched_at"
    }
}

public enum CardSearchStatus: String, Codable, Hashable, Sendable {
    case ok
    case noResults = "no_results"
}

public struct CardSearchResult: Codable, Hashable, Sendable {
    public let query: String
    public let normalizedQuery: String
    public let game: CardGame
    public let status: CardSearchStatus
    public let matches: [PricedCard]

    public init(
        query: String,
        normalizedQuery: String,
        game: CardGame,
        status: CardSearchStatus,
        matches: [PricedCard]
    ) {
        self.query = query
        self.normalizedQuery = normalizedQuery
        self.game = game
        self.status = status
        self.matches = matches
    }

    private enum CodingKeys: String, CodingKey {
        case query
        case game
        case status
        case matches
        case normalizedQuery = "normalized_query"
    }
}
