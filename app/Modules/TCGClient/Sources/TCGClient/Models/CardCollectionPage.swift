public struct CardCollectionPage: Equatable, Sendable {
    public let cards: [CardWithPrice]
    public let availableIllustrators: Set<String>
    public let availableSetNames: Set<String>
    public let nextCursor: String?

    public init(
        cards: [CardWithPrice],
        availableSetNames: Set<String>,
        nextCursor: String?,
        availableIllustrators: Set<String>
    ) {
        self.availableIllustrators = availableIllustrators
        self.cards = cards
        self.availableSetNames = availableSetNames
        self.nextCursor = nextCursor
    }
}
