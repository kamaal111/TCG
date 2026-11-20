import Foundation
import TCGClient
import TCGListSupport

struct CardCollectionPages {
    private var pages: CursorPages<CardWithPrice, UUID>
    private(set) var availableSetNames: Set<String> = []
    private(set) var availableIllustrators: Set<String> = []

    var cards: [CardWithPrice] { pages.rows }
    var pagination: CursorPagination { pages.pagination }
    var nextCursor: String? { pagination.nextCursor }
    var visitedCursors: Set<String> { pagination.visitedCursors }
    var pageCount: Int { pagination.pageCount }

    init(cards: [CardWithPrice] = [], pagination: CursorPagination = .init()) {
        pages = CursorPages(rows: cards, pagination: pagination, identity: \.card.id)
    }

    mutating func append(_ page: CardCollectionPage) -> Bool {
        guard pages.append(page.cards, nextCursor: page.nextCursor) else { return false }

        availableSetNames = page.availableSetNames
        availableIllustrators = page.availableIllustrators
        return true
    }
}
