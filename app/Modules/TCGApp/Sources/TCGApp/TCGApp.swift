//
//  TCGApp.swift
//  TCGApp
//
//  Created by Kamaal M Farah on 6/28/26.
//

import KamaalAuth
import SwiftUI
import TCGCards
import TCGClient
import TCGCurrency
import TCGDesignSystem
import TCGSearch

public struct TCGScene: Scene {
    @State private var auth: KamaalAuth
    @State private var didPromptForStartupUnlock = false
    @State private var currencyState = TCGCurrency(client: .default(), defaults: .standard)
    @State private var pricePrivacy = TCGPricePrivacy(defaults: .standard)
    @State private var cards = TCGCards.default()
    @State private var collections = TCGCollections(client: .default(), defaults: .standard)
    @State private var wishlist: TCGWishlist?
    @State private var search = TCGSearch.default()
    @State private var offline = OfflineCollection(
        client: .default(),
        defaults: .standard,
        store: .init(
            root: URL.applicationSupportDirectory.appending(path: "OfflineCollection")
        ),
        grant: OfflineCollectionGrant(namespace: "local"),
        hasFreshAuthToken: nil
    )

    public init() {
        let auth = KamaalAuth(
            client: TCGClient.default().auth,
            configuration: KamaalAuthConfiguration(
                appName: String(localized: "Mintomo", bundle: .module),
                storageNamespace: TCGClient.authenticationStorageNamespace
            )
        )
        _auth = State(initialValue: auth)
        _wishlist = State(
            initialValue: TCGClient.default().wishlist.map { client in
                TCGWishlist(client: client, accountID: { auth.session?.email })
            }
        )
        TCGNavigationAppearance.install()
    }

    public var body: some Scene {
        WindowGroup {
            OfflineCollectionHost(
                auth: auth,
                offline: offline,
                didPromptForStartupUnlock: $didPromptForStartupUnlock
            ) { startup, unlock in
                TCGAppTabs(
                    auth: auth,
                    cards: cards,
                    collections: collections,
                    currencyState: currencyState,
                    search: search,
                    wishlist: wishlist,
                    offline: offline,
                    startup: startup,
                    unlockCachedCards: unlock
                )
            }
            .maintainCardArtworkCache()
            .environment(\.tcgPricePrivacy, pricePrivacy)
        }
        #if os(macOS)
            Settings {
                TCGAppSettings(cards: cards, offline: offline)
                    .tcgCards(cards)
                    .environment(\.tcgCollections, collections)
                    .environment(auth)
                    .environment(\.tcgCurrency, currencyState)
                    .environment(\.tcgPricePrivacy, pricePrivacy)
                    .frame(width: 450)
            }
            .commands {
                CommandGroup(replacing: .appSettings) {
                    SettingsLink { Text("Settings…") }
                        .keyboardShortcut(",", modifiers: .command)
                }
            }
        #endif
    }
}
