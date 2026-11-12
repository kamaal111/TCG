import Foundation
import TCGClient

struct CardCollectionPages {
    struct Pagination {
        var nextCursor: String?
        var visitedCursors: Set<String> = []
        var pageCount = 0
    }

    private(set) var cards: [CardWithPrice]
    private(set) var availableSetNames: Set<String> = []
    private(set) var availableIllustrators: Set<String> = []
    private(set) var nextCursor: String?
    private(set) var visitedCursors: Set<String>
    private(set) var pageCount: Int
    private var cardIDs: Set<UUID>

    init(cards: [CardWithPrice] = [], pagination: Pagination = .init()) {
        self.cards = cards
        nextCursor = pagination.nextCursor
        visitedCursors = pagination.visitedCursors
        pageCount = pagination.pageCount
        cardIDs = Set(cards.map(\.card.id))
    }

    mutating func append(_ page: CardCollectionPage) -> Bool {
        if let next = page.nextCursor {
            guard !next.isEmpty else { return false }
            guard visitedCursors.insert(next).inserted else { return false }
        }
        cards.append(contentsOf: page.cards.filter { cardIDs.insert($0.card.id).inserted })
        availableSetNames = page.availableSetNames
        availableIllustrators = page.availableIllustrators
        nextCursor = page.nextCursor
        pageCount += 1
        return true
    }
}
