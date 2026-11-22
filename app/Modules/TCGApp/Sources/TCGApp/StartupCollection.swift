import Foundation
import LocalAuthentication
import Observation
import TCGClient

@MainActor
@Observable
final class StartupCollection {
    struct Preview {
        let account: String
        let cards: [CardWithPrice]
        let collections: [CardBinderCollection]
    }

    private(set) var account: String?
    private(set) var preview: Preview?
    private(set) var needsUnlockHelp = false
    private(set) var didOffer = false
    var isCollectionsTabSelected = true
    private var context: LAContext?

    var isUnlocking: Bool { context != nil }

    func offer(for account: String) -> Bool {
        guard !didOffer else { return false }

        didOffer = true
        self.account = account
        return true
    }

    func unlock(
        load: (LAContext, String) async throws -> Preview?,
        canReveal: (String) -> Bool
    ) async {
        guard let account, context == nil, preview == nil, canReveal(account) else { return }

        let attempt = LAContext()
        context = attempt
        needsUnlockHelp = false
        defer { if context === attempt { context = nil } }

        do {
            let unlocked = try await load(attempt, account)
            guard context === attempt, !Task.isCancelled, canReveal(account) else { return }

            preview = unlocked
            if unlocked == nil { self.account = nil }
        } catch {
            guard context === attempt, !Task.isCancelled, canReveal(account) else { return }

            let code = (error as? LAError)?.code
            needsUnlockHelp = code != .userCancel && code != .systemCancel && code != .appCancel
        }
    }

    func cancelUnlock() {
        context?.invalidate()
        context = nil
    }

    func dismiss() {
        cancelUnlock()
        account = nil
        preview = nil
        needsUnlockHelp = false
    }
}
