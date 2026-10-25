import Foundation
import Testing

@testable import TCGCards

struct CollectionPreferencesTests {
    private let alice = "alice@example.com"
    private let bob = "bob@example.com"

    @Test func `Last opened collection persists separately for each account`() throws {
        try withDefaults { defaults in
            let store = CollectionPreferences(defaults: defaults)
            store.save(CardsTestIDs.favoritesCollection, account: alice)
            store.save(CardsTestIDs.otherCollection, account: bob)
            let restored = CollectionPreferences(defaults: defaults)
            #expect(
                restored.restore(account: alice)
                    == CardsTestIDs.favoritesCollection
            )
            #expect(
                restored.restore(account: bob)
                    == CardsTestIDs.otherCollection
            )
            #expect(restored.restore(account: "new@example.com") == nil)
            store.save(nil, account: alice)
            #expect(CollectionPreferences(defaults: defaults).restore(account: alice) == nil)
            #expect(CollectionPreferences(defaults: defaults).restore(account: bob) == CardsTestIDs.otherCollection)
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
