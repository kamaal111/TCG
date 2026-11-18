import Foundation
import Observation
import TCGClient

@MainActor
@Observable
final class TCGWishlistScreenModel {
    var query = "" {
        didSet {
            guard searchQuery != Self.normalized(oldValue) else { return }
            invalidateRequest()
            entries = []
            cursor = nil
            failedCursor = nil
            hasLoaded = false
            error = nil
        }
    }
    var selected: PricedCard?
    var feedback: WishlistFeedback?
    private(set) var entries: [PricedCard] = []
    private(set) var hasLoaded = false
    private(set) var isLoading = false
    private(set) var error: WishlistError?
    private(set) var cursor: String?
    private(set) var loadingCursor: String?
    private(set) var failedCursor: String?
    @ObservationIgnored private var requestID = UUID()

    var searchQuery: String? { Self.normalized(query) }

    func search(using wishlist: TCGWishlist?) async {
        let query = searchQuery
        if query != nil {
            try? await Task.sleep(for: .milliseconds(300))
        }
        guard !Task.isCancelled, query == searchQuery else { return }
        await refresh(using: wishlist)
    }

    func refresh(using wishlist: TCGWishlist?) async {
        guard let wishlist else { return }
        await load(cursor: nil, using: wishlist)
    }

    func loadNextPage(using wishlist: TCGWishlist?) async {
        guard let cursor, let wishlist, error == nil, !isLoading else { return }
        await load(cursor: cursor, using: wishlist)
    }

    func retry(using wishlist: TCGWishlist?) async {
        guard let wishlist, error != nil, !isLoading else { return }
        await load(cursor: failedCursor, using: wishlist)
    }

    func didRemove(_ card: PricedCard) {
        invalidateRequest()
        entries.removeAll { $0.printingKey == card.printingKey }
        feedback = WishlistFeedback(saved: false)
    }

    private func invalidateRequest() {
        requestID = UUID()
        isLoading = false
        loadingCursor = nil
    }

    private func load(cursor requestedCursor: String?, using wishlist: TCGWishlist) async {
        let id = UUID()
        requestID = id
        isLoading = true
        loadingCursor = requestedCursor
        defer {
            if requestID == id {
                isLoading = false
                loadingCursor = nil
            }
        }
        let result = await wishlist.page(after: requestedCursor, query: searchQuery)
        guard requestID == id, !Task.isCancelled else { return }
        switch result {
        case .success(let page):
            if requestedCursor == nil {
                entries = page.entries
            } else {
                let existing = Set(entries.compactMap(\.printingKey))
                entries.append(
                    contentsOf: page.entries.filter { card in
                        card.printingKey.map { !existing.contains($0) } ?? false
                    }
                )
            }
            cursor = page.nextCursor
            hasLoaded = true
            error = nil
            failedCursor = nil
        case .failure(let error):
            self.error = error
            failedCursor = requestedCursor
        }
    }

    private static func normalized(_ query: String) -> String? {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
