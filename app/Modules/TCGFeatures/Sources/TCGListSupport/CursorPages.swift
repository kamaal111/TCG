package struct CursorPagination: Codable {
    package var nextCursor: String?
    package var visitedCursors: Set<String>
    package var pageCount: Int

    package init(nextCursor: String?, visitedCursors: Set<String>, pageCount: Int) {
        self.nextCursor = nextCursor
        self.visitedCursors = visitedCursors
        self.pageCount = pageCount
    }
}

package struct CursorPages<Row, ID: Hashable> {
    package private(set) var rows: [Row]
    package private(set) var pagination: CursorPagination
    private let identity: (Row) -> ID
    private var ids: Set<ID>

    package init(rows: [Row], pagination: CursorPagination, identity: @escaping (Row) -> ID) {
        self.rows = rows
        self.pagination = pagination
        self.identity = identity
        ids = Set(rows.map(identity))
    }

    package mutating func append(_ rows: [Row], nextCursor: String?) -> Bool {
        if let nextCursor {
            guard !nextCursor.isEmpty else { return false }
            guard pagination.visitedCursors.insert(nextCursor).inserted else { return false }
        }
        self.rows.append(contentsOf: rows.filter { ids.insert(identity($0)).inserted })
        pagination.nextCursor = nextCursor
        pagination.pageCount += 1
        return true
    }
}
