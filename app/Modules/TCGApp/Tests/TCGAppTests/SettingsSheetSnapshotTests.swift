#if os(iOS)
    import KamaalAuth
    import SwiftUI
    import TCGCurrency
    import TCGSnapshotTesting
    import Testing

    @testable import TCGApp
    @testable import TCGCards
    @testable import TCGClient

    @MainActor
    struct SettingsSheetSnapshotTests {
        @Test
        func `Presents Settings for a signed-in collector`() async throws {
            let fixture = try Fixture()
            defer { fixture.cleanUp() }
            try await fixture.auth.signIn(email: "john.doe@example.com", password: "Example-password1").get()
            try #require(fixture.auth.isLoggedIn)

            await assertPresentedScreenSnapshot(
                testName: #function,
                fileID: #fileID,
                file: #filePath,
                line: #line,
                column: #column
            ) { SettingsHost(fixture: fixture) }
            await fixture.auth.signOut()
        }

        @MainActor
        private struct Fixture {
            let auth: KamaalAuth
            let cards: TCGCards
            let collections: TCGCollections
            let currency: TCGCurrency
            let offline: OfflineCollection
            let pricePrivacy = TCGPricePrivacy(defaults: nil)
            private let defaults: UserDefaults
            private let namespace: String
            private let root: URL

            init() throws {
                let client = TCGClient.preview(hasValidCredentials: false)
                namespace = "settings-sheet-\(UUID())"
                root = URL.temporaryDirectory.appending(path: namespace)
                defaults = try #require(UserDefaults(suiteName: namespace))
                auth = KamaalAuth(
                    client: client.auth,
                    configuration: .init(appName: "Mintomo", storageNamespace: namespace)
                )
                cards = TCGCards(client: client, snapshot: .init(root: root.appending(path: "Cards")), now: Date.init)
                collections = TCGCollections(client: client, defaults: nil)
                currency = TCGCurrency(client: client, defaults: nil)
                offline = OfflineCollection(
                    client: client,
                    defaults: defaults,
                    store: .init(root: root.appending(path: "Offline")),
                    grant: OfflineCollectionGrant(namespace: namespace),
                    hasFreshAuthToken: nil
                )
            }

            func cleanUp() {
                defaults.removePersistentDomain(forName: namespace)
                try? FileManager.default.removeItem(at: root)
            }
        }

        private struct SettingsHost: View {
            let fixture: Fixture
            @State private var isPresented = false

            var body: some View {
                Color(uiColor: .systemBackground)
                    .ignoresSafeArea()
                    .modifier(
                        TCGAppSettingsSheet(
                            isPresented: $isPresented,
                            auth: fixture.auth,
                            cards: fixture.cards,
                            collections: fixture.collections,
                            currency: fixture.currency,
                            offline: fixture.offline
                        )
                    )
                    .environment(\.tcgPricePrivacy, fixture.pricePrivacy)
                    .task { isPresented = true }
            }
        }
    }
#endif
