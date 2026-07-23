//
//  CardPrice.swift
//  TCGClient
//

import Foundation

/// Direction a card's market price has moved over a reported period.
///
/// - Example:
///   ```swift
///   let trend = PriceTrend.up
///   print(trend.title)
///   ```
public enum PriceTrend: String, Codable, Hashable, Sendable {
    case up
    case down
    case flat

    /// Human-readable description suitable for display and accessibility.
    ///
    /// - Example:
    ///   ```swift
    ///   PriceTrend.down.title // "Trending down"
    ///   ```
    public var title: String {
        switch self {
        case .up: String(localized: "Trending up")
        case .down: String(localized: "Trending down")
        case .flat: String(localized: "Price is stable")
        }
    }

    /// SF Symbol representing the direction of the movement.
    ///
    /// - Example:
    ///   ```swift
    ///   Image(systemName: PriceTrend.up.systemImage)
    ///   ```
    public var systemImage: String {
        switch self {
        case .up: "arrow.up.right"
        case .down: "arrow.down.right"
        case .flat: "arrow.right"
        }
    }
}

/// Identifies the underlying figure represented by a headline price.
///
/// - Example:
///   ```swift
///   let metric = PriceMetric.lowestNearMint
///   ```
public enum PriceMetric: String, Codable, Hashable, Sendable {
    case lowestNearMint = "lowest_near_mint"
}

/// An ISO 4217 currency supplied by market pricing.
///
/// - Example:
///   ```swift
///   let currency = Currency.usd
///   ```
public enum Currency: String, Codable, Hashable, Sendable {
    case jpy = "JPY"
    case usd = "USD"
}

/// A market-price change over one fixed time period.
///
/// - Example:
///   ```swift
///   let movement = PriceMovement(priceChange: 2.50, percentChange: 4.25)
///   movement.trend // .up
///   ```
public struct PriceMovement: Codable, Hashable, Sendable {
    /// Absolute change in the price's currency.
    public let priceChange: Double
    /// Percentage change over the period.
    public let percentChange: Double

    /// Direction derived from ``priceChange``.
    public var trend: PriceTrend {
        if priceChange > 0 { return .up }
        if priceChange < 0 { return .down }
        return .flat
    }

    /// Creates a market movement from its absolute and percentage changes.
    ///
    /// - Parameters:
    ///   - priceChange: Absolute change in the price's currency.
    ///   - percentChange: Percentage change over the period.
    ///
    /// - Example:
    ///   ```swift
    ///   let movement = PriceMovement(priceChange: -1.20, percentChange: -3.50)
    ///   ```
    public init(priceChange: Double, percentChange: Double) {
        self.priceChange = priceChange
        self.percentChange = percentChange
    }

    private enum CodingKeys: String, CodingKey {
        case priceChange = "price_change"
        case percentChange = "percent_change"
    }
}

/// Provider-neutral raw Near Mint pricing for the selected base printing.
///
/// - Example:
///   ```swift
///   let price = MarketPrice(currency: .usd, low: 10, market: 12)
///   ```
public struct MarketPrice: Codable, Hashable, Sendable {
    /// Raw-card condition used by this price.
    public let condition: CardCondition
    /// Currency shared by all amounts and absolute movements.
    public let currency: Currency
    /// Lowest known Near Mint price, when supplied.
    public let low: Double?
    /// Average Near Mint market price, when supplied.
    public let market: Double?
    /// Seven-day market movement, when supplied.
    public let trend7d: PriceMovement?
    /// Thirty-day market movement, when supplied.
    public let trend30d: PriceMovement?

    /// Creates normalized market pricing for a base card variant.
    ///
    /// - Parameters:
    ///   - condition: Raw-card condition, fixed to Near Mint by default.
    ///   - currency: Currency for the monetary values.
    ///   - low: Lowest known price.
    ///   - market: Average market price.
    ///   - trend7d: Seven-day market movement.
    ///   - trend30d: Thirty-day market movement.
    ///
    /// - Example:
    ///   ```swift
    ///   let price = MarketPrice(currency: .usd, low: 10, market: 12)
    ///   ```
    public init(
        condition: CardCondition = .nearMint,
        currency: Currency,
        low: Double? = nil,
        market: Double? = nil,
        trend7d: PriceMovement? = nil,
        trend30d: PriceMovement? = nil
    ) {
        self.condition = condition
        self.currency = currency
        self.low = low
        self.market = market
        self.trend7d = trend7d
        self.trend30d = trend30d
    }

    private enum CodingKeys: String, CodingKey {
        case condition
        case currency
        case low
        case market
        case trend7d = "trend_7d"
        case trend30d = "trend_30d"
    }
}

/// The single lowest Near Mint price selected for compact display.
///
/// - Example:
///   ```swift
///   let headline = PriceHeadline(amount: 10, currency: .usd)
///   ```
public struct PriceHeadline: Codable, Hashable, Sendable {
    /// Headline monetary amount.
    public let amount: Double
    /// Currency of ``amount``.
    public let currency: Currency
    /// Market metric represented by ``amount``.
    public let metric: PriceMetric

    /// Creates a headline price.
    ///
    /// - Parameters:
    ///   - amount: Headline monetary amount.
    ///   - currency: Currency of the amount.
    ///   - metric: Underlying pricing metric.
    ///
    /// - Example:
    ///   ```swift
    ///   let headline = PriceHeadline(amount: 10, currency: .usd)
    ///   ```
    public init(amount: Double, currency: Currency, metric: PriceMetric = .lowestNearMint) {
        self.amount = amount
        self.currency = currency
        self.metric = metric
    }
}

/// A card and its normalized daily market pricing.
///
/// - Example:
///   ```swift
///   let card = PricedCard(
///       id: "price-id",
///       game: .pokemon,
///       name: "Charizard",
///       cardNumber: "4",
///       pricedOn: .now,
///       fetchedAt: .now
///   )
///   ```
public struct PricedCard: Codable, Hashable, Identifiable, Sendable {
    public let id: String
    public let game: ClientCardGame
    public let name: String
    public let cardNumber: String
    public let rarity: String?
    public let imageURL: String?
    public let headline: PriceHeadline?
    public let market: MarketPrice?
    public let pricedOn: Date
    public let fetchedAt: Date

    /// Creates a priced card returned by search or owned-card pricing.
    ///
    /// - Example:
    ///   ```swift
    ///   let card = PricedCard(
    ///       id: "price-id", game: .pokemon, name: "Charizard", cardNumber: "4",
    ///       pricedOn: .now, fetchedAt: .now
    ///   )
    ///   ```
    public init(
        id: String,
        game: ClientCardGame,
        name: String,
        cardNumber: String,
        rarity: String? = nil,
        imageURL: String? = nil,
        headline: PriceHeadline? = nil,
        market: MarketPrice? = nil,
        pricedOn: Date,
        fetchedAt: Date
    ) {
        self.id = id
        self.game = game
        self.name = name
        self.cardNumber = cardNumber
        self.rarity = rarity
        self.imageURL = imageURL
        self.headline = headline
        self.market = market
        self.pricedOn = pricedOn
        self.fetchedAt = fetchedAt
    }

    private enum CodingKeys: String, CodingKey {
        case game
        case name
        case rarity
        case headline
        case market
        case id
        case cardNumber = "card_number"
        case imageURL = "image_url"
        case pricedOn = "priced_on"
        case fetchedAt = "fetched_at"
    }
}

/// Result of searching for cards and their pricing.
///
/// - Example:
///   ```swift
///   let result = CardSearchResult(matches: [])
///   ```
public struct CardSearchResult: Codable, Hashable, Sendable {
    public let matches: [PricedCard]

    /// Creates a search result from its ordered matches.
    ///
    /// - Example:
    ///   ```swift
    ///   let result = CardSearchResult(matches: [])
    ///   ```
    public init(matches: [PricedCard]) {
        self.matches = matches
    }
}
