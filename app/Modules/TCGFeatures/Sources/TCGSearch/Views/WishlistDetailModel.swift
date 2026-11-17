import Observation
import TCGClient

@MainActor
@Observable
final class WishlistDetailModel {
    struct Action {
        let saved: Bool
        let dismissAfter: Bool
    }

    enum Outcome {
        case membershipChanged(Bool)
        case removed
    }

    var showsError = false
    var feedback: WishlistFeedback?
    var acquiredPrintingKey: String?
    private(set) var isWishlisted: Bool?
    private(set) var error: WishlistError?
    private(set) var retryAction: Action?
    private var task: Task<Void, Never>?

    var isWorking: Bool { task != nil }

    init(isWishlistEntry: Bool) {
        isWishlisted = isWishlistEntry ? true : nil
    }

    func run(
        _ action: Action,
        for card: PricedCard,
        using wishlist: TCGWishlist?,
        onCompletion: @escaping (Outcome) -> Void
    ) {
        guard task == nil else { return }
        task = Task {
            let outcome = await perform(action, for: card, using: wishlist)
            task = nil
            if let outcome { onCompletion(outcome) }
        }
    }

    func prepareAcquisition(for card: PricedCard) -> Bool {
        guard (isWishlisted ?? card.isWishlisted) == true, let key = card.printingKey else { return false }
        acquiredPrintingKey = key
        return true
    }

    func cancel() {
        task?.cancel()
    }

    private func perform(_ action: Action, for card: PricedCard, using wishlist: TCGWishlist?) async -> Outcome? {
        guard let wishlist, let key = card.printingKey, !Task.isCancelled else { return nil }
        let result: Result<Bool, WishlistError>
        if action.saved {
            result = await wishlist.save(pricedCardID: card.id).map { true }
        } else {
            result = await wishlist.remove(printingKey: key).map { false }
        }
        guard !Task.isCancelled else { return nil }

        switch result {
        case .success(let saved):
            error = nil
            isWishlisted = saved
            if action.dismissAfter { return .removed }
            feedback = WishlistFeedback(saved: saved)
            return .membershipChanged(saved)
        case .failure(let error):
            retryAction = action
            self.error = error
            showsError = true
        }
        return nil
    }
}
