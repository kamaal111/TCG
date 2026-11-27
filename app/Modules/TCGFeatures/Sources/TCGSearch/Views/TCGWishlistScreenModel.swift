import Foundation
import Observation
import TCGCardDetails
import TCGClient
import TCGListSupport
import TCGModels
import TCGWishlist

@MainActor
@Observable
final class TCGWishlistScreenModel {
    private typealias Pages = CursorPages<PricedCard, String>

    let filterState: CardListFilterState

    var selected: PricedCard?
    var feedback: WishlistFeedback?
    private(set) var entries: [PricedCard] = []
    private(set) var hasLoaded = false
    private(set) var isLoading = false
    private(set) var isRefreshing = false
    private(set) var error: WishlistError?
    private(set) var loadingCursor: String?
    private(set) var failedCursor: String?
    private(set) var availableSetNames: Set<String> = []
    private(set) var availableIllustrators: Set<String> = []
    private var pagination = CursorPagination(nextCursor: nil, visitedCursors: [], pageCount: 0)
    @ObservationIgnored private var requestID = UUID()
    @ObservationIgnored private var activeFilters: CardListFilters?
    @ObservationIgnored private var context: TCGWishlist.ReadContext?
    @ObservationIgnored private var checkedAt: Date?
    @ObservationIgnored private var currency: Currency?
    @ObservationIgnored private var snapshotVersion: UUID?
    @ObservationIgnored private var requestedDepth = 1

    var cursor: String? { pagination.nextCursor }

    init(preferences: UserDefaults?) {
        filterState = CardListFilterState(preferences: preferences, preferenceScope: .wishlist)
    }

    func search(using wishlist: TCGWishlist?, currency: Currency?) async {
        await reload(using: wishlist, currency: currency, force: false)
    }

    func refresh(using wishlist: TCGWishlist?, currency: Currency?) async {
        await reload(using: wishlist, currency: currency, force: true)
    }

    func loadNextPage(using wishlist: TCGWishlist?) async {
        guard let wishlist, cursor != nil, error == nil, !isLoading else { return }
        guard let context, wishlist.readContextAfterAccountSync() == context, let activeFilters,
            activeFilters == filterState.filters
        else { return }
        await load(
            from: currentPages,
            through: pagination.pageCount + 1,
            using: wishlist,
            context: context,
            filters: activeFilters,
            debounce: false
        )
    }

    func retry(using wishlist: TCGWishlist?) async {
        guard let wishlist, error != nil, !isLoading else { return }
        guard let context, wishlist.readContextAfterAccountSync() == context, let activeFilters,
            activeFilters == filterState.filters
        else {
            await refresh(using: wishlist, currency: currency)
            return
        }
        let pages =
            failedCursor == nil
            ? Pages(
                rows: [],
                pagination: .init(nextCursor: nil, visitedCursors: [], pageCount: 0),
                identity: Self.identity
            ) : currentPages
        await load(
            from: pages,
            through: requestedDepth,
            using: wishlist,
            context: context,
            filters: activeFilters,
            debounce: false
        )
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
        guard let wishlist, let context = wishlist.readContextAfterAccountSync() else {
            resetList(keepingChoices: false)
            self.context = nil
            activeFilters = nil
            return
        }
        let filters = filterState.filters
        let debounce = !force && filters.query != nil && filters.query != activeFilters?.query
        if self.context != context || activeFilters != filters {
            resetList(keepingChoices: self.context == context && activeFilters?.game == filters.game)
        }
        self.context = context
        activeFilters = filters
        let snapshot = wishlist.snapshot(for: filters)
        snapshotVersion = snapshot?.version
        if let snapshot {
            entries = snapshot.entries
            pagination = snapshot.pagination
            availableSetNames = snapshot.availableSetNames ?? []
            availableIllustrators = snapshot.availableIllustrators ?? []
            let hasChoices = snapshot.availableSetNames != nil && snapshot.availableIllustrators != nil
            checkedAt = hasChoices && snapshot.currency == currency ? snapshot.checkedAt : nil
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
            from: Pages(
                rows: [],
                pagination: .init(nextCursor: nil, visitedCursors: [], pageCount: 0),
                identity: Self.identity
            ),
            through: max(1, pagination.pageCount),
            using: wishlist,
            context: context,
            filters: filters,
            debounce: debounce
        )
    }

    private func resetList(keepingChoices: Bool) {
        if !keepingChoices {
            availableSetNames = []
            availableIllustrators = []
        }
        invalidateRequest()
        entries = []
        pagination = CursorPagination(nextCursor: nil, visitedCursors: [], pageCount: 0)
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
        filters: CardListFilters,
        debounce: Bool
    ) async {
        let id = UUID()
        requestID = id
        requestedDepth = depth
        isLoading = true
        isRefreshing = initial.pagination.pageCount == 0
        loadingCursor = initial.pagination.nextCursor
        var canPersist = true
        defer {
            if requestID == id { invalidateRequest() }
        }

        func checkLoadContext() -> Bool {
            guard requestID == id, !Task.isCancelled, filterState.filters == filters else { return false }
            return wishlist.readContextAfterAccountSync() == context
        }

        if debounce { try? await Task.sleep(for: .milliseconds(300)) }
        guard checkLoadContext() else { return }

        let result = await CachedListLoad.load(
            initial,
            through: depth,
            pagination: \.pagination,
            fetch: { pages in
                guard checkLoadContext() else {
                    return Result<Bool, WishlistError>.success(false)
                }
                let cursor = pages.pagination.nextCursor
                self.loadingCursor = cursor
                let result = await wishlist.page(.init(filters: filters, cursor: cursor))
                guard checkLoadContext() else {
                    return Result<Bool, WishlistError>.success(false)
                }
                switch result {
                case .failure(let error): return .failure(error)
                case .success(let page):
                    guard pages.append(page.entries, nextCursor: page.nextCursor) else { return .failure(.unavailable) }
                    self.availableSetNames = page.availableSetNames
                    self.availableIllustrators = page.availableIllustrators
                    return .success(true)
                }
            },
            publish: { pages, _ in
                guard checkLoadContext() else { return }
                self.entries = pages.rows
                self.pagination = pages.pagination
                self.hasLoaded = true
                self.error = nil
                self.failedCursor = nil
                if pages.pagination.pageCount == 1 { self.checkedAt = wishlist.now() }

                let snapshot = TCGWishlist.Snapshot(
                    filters: filters,
                    availableSetNames: self.availableSetNames,
                    availableIllustrators: self.availableIllustrators,
                    entries: pages.rows,
                    pagination: pages.pagination,
                    checkedAt: self.checkedAt,
                    currency: self.currency,
                    version: UUID()
                )
                if canPersist {
                    canPersist = wishlist.saveSnapshot(snapshot, replacing: self.snapshotVersion)
                    if canPersist { self.snapshotVersion = snapshot.version }
                }
            }
        )
        guard checkLoadContext() else { return }
        if case .failure(let error) = result {
            if error == .unauthorized {
                resetList(keepingChoices: false)
                wishlist.clearSnapshots()
            }
            self.error = error
            failedCursor = loadingCursor
        }
    }

    private static func identity(_ card: PricedCard) -> String {
        card.printingKey.map { "printing:\($0)" } ?? "card:\(card.id)"
    }
}
