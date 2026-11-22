import LocalAuthentication
import Testing

@testable import TCGApp

@MainActor
struct StartupCollectionTests {
    @Test func `A session that finishes before device unlock skips the prompt`() async {
        let startup = StartupCollection()
        #expect(startup.offer(for: "owner@example.test"))

        await startup.unlock { _, _ in
            Issue.record("Device authentication must not start after sign-in finishes.")
            return nil
        } canReveal: { _ in
            false
        }

        #expect(!startup.isUnlocking)
        #expect(startup.preview == nil)
    }

    @Test func `A successful manual passcode retry opens the cache after biometric denial`() async {
        let startup = StartupCollection()
        #expect(startup.offer(for: "owner@example.test"))

        await startup.unlock { _, _ in
            throw LAError(.biometryNotAvailable)
        } canReveal: { _ in
            true
        }

        #expect(startup.preview == nil)
        #expect(startup.needsUnlockHelp)
        #expect(!startup.offer(for: "owner@example.test"))

        await startup.unlock { _, account in
            .init(account: account, cards: [], collections: [])
        } canReveal: { _ in
            true
        }

        #expect(startup.preview?.account == "owner@example.test")
        #expect(!startup.needsUnlockHelp)
    }

    @Test func `Cancelling device unlock keeps the cache hidden and permits a manual retry`() async {
        let startup = StartupCollection()
        #expect(startup.offer(for: "owner@example.test"))

        await startup.unlock { _, _ in
            throw LAError(.userCancel)
        } canReveal: { _ in
            true
        }

        #expect(startup.preview == nil)
        #expect(startup.account == "owner@example.test")
        #expect(!startup.isUnlocking)
        #expect(!startup.needsUnlockHelp)
        #expect(!startup.offer(for: "owner@example.test"))
    }

    @Test func `An unlock finishing after the live session is ready is discarded`() async {
        let startup = StartupCollection()
        #expect(startup.offer(for: "owner@example.test"))

        await startup.unlock { _, account in
            startup.cancelUnlock()
            return .init(account: account, cards: [], collections: [])
        } canReveal: { _ in
            true
        }

        #expect(startup.preview == nil)
        #expect(!startup.isUnlocking)
    }

    @Test func `An unlock finishing after account rejection cannot reveal cached cards`() async {
        let startup = StartupCollection()
        #expect(startup.offer(for: "owner@example.test"))

        await startup.unlock { _, account in
            startup.dismiss()
            return .init(account: account, cards: [], collections: [])
        } canReveal: { _ in
            true
        }

        #expect(startup.preview == nil)
        #expect(startup.account == nil)
    }

    @Test func `Temporary unavailability leaves the preview open until the user dismisses it`() async {
        let startup = StartupCollection()
        #expect(startup.offer(for: "owner@example.test"))
        await startup.unlock { _, account in
            .init(account: account, cards: [], collections: [])
        } canReveal: { _ in
            true
        }

        startup.cancelUnlock()
        #expect(startup.preview?.account == "owner@example.test")

        startup.dismiss()
        #expect(startup.preview == nil)
    }
}
