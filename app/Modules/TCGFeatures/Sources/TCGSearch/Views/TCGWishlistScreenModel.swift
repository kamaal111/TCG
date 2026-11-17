import Foundation
import Observation
import TCGClient

@MainActor
@Observable
final class TCGWishlistScreenModel {
    var selected: PricedCard?
    var feedback: WishlistFeedback?
    private(set) var entries: [PricedCard] = []
    private(set) var hasLoaded = false
    private(set) var isLoading = false
    private(set) var error: WishlistError?
    private var cursor: String?
    private var failedCursor: String?
    @ObservationIgnored private var requestID = UUID()

    var hasNextPage: Bool { cursor != nil }

    func refresh(using wishlist: TCGWishlist?) async {
        guard let wishlist else { return }
        await load(cursor: nil, using: wishlist)
    }

    func loadNextPage(using wishlist: TCGWishlist?) async {
        guard let cursor, let wishlist else { return }
        await load(cursor: cursor, using: wishlist)
    }

    func retry(using wishlist: TCGWishlist?) async {
        guard let wishlist else { return }
        await load(cursor: failedCursor, using: wishlist)
    }

    func didRemove(_ card: PricedCard) {
        requestID = UUID()
        isLoading = false
        entries.removeAll { $0.printingKey == card.printingKey }
        feedback = WishlistFeedback(saved: false)
    }

    private func load(cursor requestedCursor: String?, using wishlist: TCGWishlist) async {
        guard requestedCursor == nil || !isLoading else { return }
        let id = UUID()
        requestID = id
        isLoading = true
        defer { if requestID == id { isLoading = false } }
        let result = await wishlist.page(after: requestedCursor)
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
        case .failure(let error):
            self.error = error
            failedCursor = requestedCursor
        }
    }
}
