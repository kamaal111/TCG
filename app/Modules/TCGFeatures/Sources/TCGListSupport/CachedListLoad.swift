import Foundation

package enum CachedListLoad {
    package static func isFresh(_ checkedAt: Date?, at now: Date) -> Bool {
        guard let checkedAt else { return false }

        let age = now.timeIntervalSince(checkedAt)
        return age >= 0 && age < 15 * 60
    }

    package static func restoreWithoutFetching(checkedAt: Date?, now: Date, force: Bool) -> Bool {
        !force && isFresh(checkedAt, at: now)
    }

    package static func store<Entry, Scope: Equatable>(
        _ entry: Entry,
        in entries: inout [Entry],
        keyedBy scope: KeyPath<Entry, Scope>,
        keeping pinned: Scope
    ) {
        entries.removeAll { $0[keyPath: scope] == entry[keyPath: scope] }
        entries.insert(entry, at: 0)
        let limit = entries.contains { $0[keyPath: scope] == pinned } ? 9 : 8
        if entries.count > limit, let last = entries.lastIndex(where: { $0[keyPath: scope] != pinned }) {
            entries.remove(at: last)
        }
    }

    @MainActor
    package static func load<Pages, Failure: Error>(
        _ initial: Pages,
        through depth: Int,
        pagination: (Pages) -> CursorPagination,
        fetch: @MainActor (inout Pages) async -> Result<Bool, Failure>,
        publish: @MainActor (Pages, _ isFinal: Bool) -> Void
    ) async -> Result<Void, Failure> {
        var pages = initial
        repeat {
            switch await fetch(&pages) {
            case .failure(let error): return .failure(error)
            case .success(false): return .success(())
            case .success(true):
                let state = pagination(pages)
                let isFinal = state.nextCursor == nil || state.pageCount >= depth
                publish(pages, isFinal)
                if isFinal { return .success(()) }
            }
        } while !Task.isCancelled
        return .success(())
    }
}
