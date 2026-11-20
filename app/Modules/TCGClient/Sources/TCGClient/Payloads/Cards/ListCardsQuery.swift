import Foundation

public struct ListCardsQuery: Hashable, Sendable {
    public let filters: CardListFilters
    public let cursor: String?
    public let collectionID: UUID?
    public var game: ClientCardGame? { filters.game }

    public var illustrators: Set<String> { filters.illustrators }

    public var setNames: Set<String> { filters.setNames }

    public var query: String? { filters.query }

    public init(filters: CardListFilters, cursor: String?, collectionID: UUID?) {
        self.filters = filters
        self.cursor = cursor
        self.collectionID = collectionID
    }

    public init(
        game: ClientCardGame?,
        setNames: Set<String>,
        cursor: String?,
        collectionID: UUID?,
        query: String?,
        illustrators: Set<String>
    ) {
        self.init(
            filters: .init(game: game, setNames: setNames, illustrators: illustrators, query: query),
            cursor: cursor,
            collectionID: collectionID
        )
    }
}
