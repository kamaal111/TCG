public struct WishlistPage: Equatable, Sendable {
    public let entries: [PricedCard]
    public let nextCursor: String?
    public let availableSetNames: Set<String>
    public let availableIllustrators: Set<String>

    public init(
        entries: [PricedCard],
        nextCursor: String?,
        availableSetNames: Set<String>,
        availableIllustrators: Set<String>
    ) {
        self.entries = entries
        self.nextCursor = nextCursor
        self.availableSetNames = availableSetNames
        self.availableIllustrators = availableIllustrators
    }
}
