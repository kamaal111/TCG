import Foundation
import Observation
import TCGClient
import TCGListSupport

@MainActor
@Observable
final class TCGWishlistScreenModel {
    private typealias Pages = CursorPages<PricedCard, String>

    var query = "" {
        didSet {
            guard searchQuery != Self.normalized(oldValue) else { return }
            resetList()
        }
    }
    var selected: PricedCard?
    var feedback: WishlistFeedback?
    private(set) var entries: [PricedCard] = []
    private(set) var hasLoaded = false
    private(set) var isLoading = false
    private(set) var isRefreshing = false
    private(set) var error: WishlistError?
    private(set) var loadingCursor: String?
    private(set) var failedCursor: String?
    private var pagination = CursorPagination()
    @ObservationIgnored private var requestID = UUID()
    @ObservationIgnored private var context: TCGWishlist.ReadContext?
    @ObservationIgnored private var checkedAt: Date?
    @ObservationIgnored private var currency: Currency?
    @ObservationIgnored private var snapshotVersion: UUID?
    @ObservationIgnored private var requestedDepth = 1

    var cursor: String? { pagination.nextCursor }
    var searchQuery: String? { Self.normalized(query) }

    func search(using wishlist: TCGWishlist?, currency: Currency? = nil) async {
        await reload(using: wishlist, currency: currency, force: false)
    }

    func refresh(using wishlist: TCGWishlist?, currency: Currency? = nil) async {
        await reload(using: wishlist, currency: currency, force: true)
    }

    func loadNextPage(using wishlist: TCGWishlist?) async {
        guard let wishlist, cursor != nil, error == nil, !isLoading else { return }
        guard let context, wishlist.readContext() == context else { return }
        await load(from: currentPages, through: pagination.pageCount + 1, using: wishlist, context: context)
    }

    func retry(using wishlist: TCGWishlist?) async {
        guard let wishlist, error != nil, !isLoading else { return }
        guard let context, wishlist.readContext() == context else {
            await refresh(using: wishlist, currency: currency)
            return
        }
        let pages = failedCursor == nil ? Pages(identity: Self.identity) : currentPages
        await load(from: pages, through: requestedDepth, using: wishlist, context: context)
    }

    func didRemove(_ card: PricedCard) {
        invalidateRequest()
        entries.removeAll { $0.printingKey == card.printingKey }
        feedback = WishlistFeedback(saved: false)
    }

    private var currentPages: Pages {
        Pages(rows: entries, pagination: pagination, identity: Self.identity)
    }

    private func reload(using wishlist: TCGWishlist?, currency: Currency?, force: Bool) async {
        guard let wishlist, let context = wishlist.readContext() else {
            resetList()
            return
        }
        if self.context != context { resetList() }
        self.context = context
        let snapshot = wishlist.snapshot(for: searchQuery)
        snapshotVersion = snapshot?.version
        if let snapshot {
            entries = snapshot.entries
            pagination = snapshot.pagination
            checkedAt = snapshot.currency == currency ? snapshot.checkedAt : nil
            hasLoaded = true
        } else if self.currency != currency {
            checkedAt = nil
        }
        self.currency = currency
        if CachedListLoad.restoreWithoutFetching(checkedAt: checkedAt, now: wishlist.now(), force: force) {
            invalidateRequest()
            error = nil
            failedCursor = nil
            return
        }

        await load(
            from: Pages(identity: Self.identity),
            through: max(1, pagination.pageCount),
            using: wishlist,
            context: context,
            debounce: !force && searchQuery != nil
        )
    }

    private func resetList() {
        invalidateRequest()
        entries = []
        pagination = CursorPagination()
        checkedAt = nil
        snapshotVersion = nil
        failedCursor = nil
        hasLoaded = false
        error = nil
    }

    private func invalidateRequest() {
        requestID = UUID()
        isLoading = false
        isRefreshing = false
        loadingCursor = nil
    }

    private func load(
        from initial: Pages,
        through depth: Int,
        using wishlist: TCGWishlist,
        context: TCGWishlist.ReadContext,
        debounce: Bool = false
    ) async {
        let id = UUID()
        let query = searchQuery
        requestID = id
        requestedDepth = depth
        isLoading = true
        isRefreshing = initial.pagination.pageCount == 0
        loadingCursor = initial.pagination.nextCursor
        var canPersist = true
        defer {
            if requestID == id { invalidateRequest() }
        }

        if debounce { try? await Task.sleep(for: .milliseconds(300)) }
        guard requestID == id, !Task.isCancelled, wishlist.readContext() == context else { return }

        let result = await CachedListLoad.load(
            initial,
            through: depth,
            pagination: \.pagination,
            fetch: { pages in
                guard self.requestID == id, !Task.isCancelled, wishlist.readContext() == context else {
                    return Result<Bool, WishlistError>.success(false)
                }
                let cursor = pages.pagination.nextCursor
                self.loadingCursor = cursor
                let result = await wishlist.page(after: cursor, query: query)
                guard self.requestID == id, !Task.isCancelled, wishlist.readContext() == context else {
                    return Result<Bool, WishlistError>.success(false)
                }
                switch result {
                case .failure(let error): return .failure(error)
                case .success(let page):
                    guard pages.append(page.entries, nextCursor: page.nextCursor) else { return .failure(.unavailable) }
                    return .success(true)
                }
            },
            publish: { pages, _ in
                guard self.requestID == id, !Task.isCancelled, wishlist.readContext() == context else { return }
                self.entries = pages.rows
                self.pagination = pages.pagination
                self.hasLoaded = true
                self.error = nil
                self.failedCursor = nil
                if pages.pagination.pageCount == 1 { self.checkedAt = wishlist.now() }

                let snapshot = TCGWishlist.Snapshot(
                    query: query,
                    entries: pages.rows,
                    pagination: pages.pagination,
                    checkedAt: self.checkedAt,
                    currency: self.currency
                )
                if canPersist {
                    canPersist = wishlist.saveSnapshot(snapshot, replacing: self.snapshotVersion)
                    if canPersist { self.snapshotVersion = snapshot.version }
                }
            }
        )
        guard requestID == id, !Task.isCancelled, wishlist.readContext() == context else { return }
        if case .failure(let error) = result {
            if error == .unauthorized {
                resetList()
                wishlist.clearSnapshots()
            }
            self.error = error
            failedCursor = loadingCursor
        }
    }

    private static func identity(_ card: PricedCard) -> String {
        card.printingKey.map { "printing:\($0)" } ?? "card:\(card.id)"
    }

    private static func normalized(_ query: String) -> String? {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
