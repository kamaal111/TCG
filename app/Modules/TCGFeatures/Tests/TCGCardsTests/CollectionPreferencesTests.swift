import Foundation
import Testing

@testable import TCGCards

struct CollectionPreferencesTests {
    private let alice = "alice@example.com"
    private let bob = "bob@example.com"

    @Test func `All destination types persist separately for each account`() throws {
        try withDefaults { defaults in
            let store = CollectionPreferences(defaults: defaults)
            let favorites = CollectionDestination.named(CardsTestIDs.favoritesCollection)
            store.saveDestination(.system(.wishlist), account: alice)
            store.saveDestination(favorites, account: bob)
            let restored = CollectionPreferences(defaults: defaults)
            #expect(restored.restoreDestination(account: alice) == .system(.wishlist))
            #expect(restored.restoreDestination(account: bob) == favorites)

            store.saveDestination(.allCards, account: alice)
            let reopened = CollectionPreferences(defaults: defaults)
            #expect(reopened.restoreDestination(account: alice) == .allCards)
            #expect(reopened.restoreDestination(account: bob) == favorites)
            #expect(defaults.string(forKey: "TCG.collections.destination.\(alice)") == "system:all-cards")
        }
    }

    @Test(
        arguments: [nil, "system:unrecognized", "named:invalid-uuid"] as [String?]
    )
    func `Missing or unrecognized destinations fall back to All cards with legacy data present`(
        value: String?
    ) throws {
        try withDefaults { defaults in
            defaults.set(CardsTestIDs.favoritesCollection.uuidString, forKey: "TCG.collections.last.\(alice)")
            defaults.set(value, forKey: "TCG.collections.destination.\(alice)")
            #expect(CollectionPreferences(defaults: defaults).restoreDestination(account: alice) == .allCards)
        }
    }

    @Test func `Collection views survive recreation and stay separate by collection and account`() throws {
        try withDefaults { defaults in
            let favorites = CardsTestIDs.favoritesCollection
            let other = CardsTestIDs.otherCollection
            let store = CollectionPreferences(defaults: defaults)
            store.saveView(.binder, account: alice, collectionID: favorites)
            store.saveView(.list, account: alice, collectionID: other)
            store.saveView(.list, account: bob, collectionID: favorites)
            let reopened = CollectionPreferences(defaults: defaults)
            #expect(reopened.restoreView(account: alice, collectionID: favorites) == .binder)
            #expect(reopened.restoreView(account: alice, collectionID: other) == .list)
            #expect(reopened.restoreView(account: bob, collectionID: favorites) == .list)
            #expect(reopened.restoreView(account: bob, collectionID: other) == nil)
            reopened.saveView(.list, account: alice, collectionID: favorites)
            let restored = CollectionPreferences(defaults: defaults)
            #expect(restored.restoreView(account: alice, collectionID: favorites) == .list)
        }
    }

    private func withDefaults(_ body: (UserDefaults) -> Void) throws {
        let suite = "TCG.collections.tests.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        body(defaults)
    }
}
