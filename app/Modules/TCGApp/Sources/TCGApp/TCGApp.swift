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
            }
            .tcgCards(cards)
            .tcgSearch(search)
            .kamaalAuth(auth)
        }
    }
}
