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
import TCGSearch
import TCGSettings

public struct TCGScene: Scene {
    @State private var auth = KamaalAuth(
        client: TCGClient.default().auth,
        configuration: KamaalAuthConfiguration(
            appName: "TCG",
            storageNamespace: "\(Bundle.main.bundleIdentifier ?? "io.kamaal.TCG").TCGAuth"
        )
    )
    @State private var cards = TCGCards.default()
    @State private var search = TCGSearch.default()

    public init() {}

    public var body: some Scene {
        WindowGroup {
            TabView {
                NavigationStack { TCGCardsListScreen() }
                    .tabItem { Label("Collection", systemImage: "square.stack") }

                NavigationStack { TCGSearchScreen() }
                    .tabItem { Label("Search", systemImage: "magnifyingglass") }

                #if !os(macOS)
                    NavigationStack { TCGSettingsScreen() }
                        .tabItem { Label("Settings", systemImage: "gearshape") }
                #endif
            }
            .tcgCards(cards)
            .tcgSearch(search)
            .kamaalAuth(auth)
        }
        #if os(macOS)
            Settings {
                TCGSettingsScreen()
                    .environment(auth)
                    .frame(width: 450)
            }
            .commands {
                // Settings only make sense for a signed-in account, so hide the menu item (and its Command-Comma
                // shortcut) instead of showing the sign-in screen in the Settings window.
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
