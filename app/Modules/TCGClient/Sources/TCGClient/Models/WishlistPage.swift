public struct WishlistPage: Equatable, Sendable {
    public let entries: [PricedCard]
    public let nextCursor: String?

    public init(entries: [PricedCard], nextCursor: String?) {
        self.entries = entries
        self.nextCursor = nextCursor
    }
}
