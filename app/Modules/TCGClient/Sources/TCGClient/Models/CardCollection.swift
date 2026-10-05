public struct CardCollection: Equatable, Sendable {
    public let cards: [CardWithPrice]
    public let availableSetNames: Set<String>

    public init(cards: [CardWithPrice], availableSetNames: Set<String>) {
        self.cards = cards
        self.availableSetNames = availableSetNames
    }
}
