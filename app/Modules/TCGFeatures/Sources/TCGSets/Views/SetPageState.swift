import Foundation
import TCGClient
import TCGListSupport

struct SetPageState<Entry: Identifiable & Sendable> {
    private var pages = Self.emptyPages()
    private var requestID: UUID?
    private(set) var failed = false
    private var retryFromStart = false

    var entries: [Entry] { pages.rows }
    var isLoading: Bool { requestID != nil }
    var hasLoaded: Bool { pages.pagination.pageCount > 0 }
    var canLoadMore: Bool { failed || pages.pagination.nextCursor != nil }
    var nextCursor: String? { retryFromStart ? nil : pages.pagination.nextCursor }

    mutating func begin() -> UUID {
        let id = UUID()
        requestID = id
        return id
    }

    @discardableResult
    mutating func finish(
        _ id: UUID,
        result: Result<CatalogSetPage<Entry>, CatalogSetsError>,
        replacing: Bool
    ) -> Bool {
        guard requestID == id else { return false }
        requestID = nil
        guard !Task.isCancelled else { return false }
        switch result {
        case .success(let page):
            var updated = replacing ? Self.emptyPages() : pages
            guard updated.append(page.entries, nextCursor: page.nextCursor) else {
                failed = true
                retryFromStart = true
                return false
            }
            pages = updated
            failed = false
            retryFromStart = false
            return true
        case .failure:
            failed = true
            retryFromStart = replacing
            return false
        }
    }

    private static func emptyPages() -> CursorPages<Entry, Entry.ID> {
        .init(rows: [], pagination: .init(nextCursor: nil, visitedCursors: [], pageCount: 0), identity: \.id)
    }
}
