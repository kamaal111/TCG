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
import TCGSearch

public struct TCGScene: Scene {
    @State private var auth = KamaalAuth(
        client: TCGClient.default().auth,
        configuration: KamaalAuthConfiguration(
            appName: String(localized: "Mintomo", bundle: .module),
            storageNamespace: TCGClient.authenticationStorageNamespace
        )
    )
    @State private var currencyState = TCGCurrency()
    @State private var cards = TCGCards.default()
    @State private var collections = TCGCollections(client: .default(), defaults: .standard)
    @State private var search = TCGSearch.default()
    @State private var offline = OfflineCollection(client: .default(), defaults: .standard)

    public init() {}

    public var body: some Scene {
        WindowGroup {
            OfflineCollectionHost(auth: auth, offline: offline) {
                TCGAppTabs(
                    auth: auth,
                    cards: cards,
                    collections: collections,
                    currencyState: currencyState,
                    search: search,
                    offline: offline
                )
            }
        }
        #if os(macOS)
            Settings {
                TCGAppSettings(cards: cards, offline: offline)
                    .tcgCards(cards)
                    .environment(\.tcgCollections, collections)
                    .environment(auth)
                    .environment(\.tcgCurrency, currencyState)
                    .frame(width: 450)
            }
            .commands {
                CommandGroup(replacing: .appSettings) {
                    if auth.isLoggedIn {
                        SettingsLink { Text("Settings…") }
                            .keyboardShortcut(",", modifiers: .command)
                    }
                }
            }
        #endif
    }
}
