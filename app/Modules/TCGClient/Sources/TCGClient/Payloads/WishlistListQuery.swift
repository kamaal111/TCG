public struct WishlistListQuery: Hashable, Sendable {
    public let filters: CardListFilters
    public let cursor: String?

    public init(filters: CardListFilters, cursor: String?) {
        self.filters = filters
        self.cursor = cursor
    }
}
