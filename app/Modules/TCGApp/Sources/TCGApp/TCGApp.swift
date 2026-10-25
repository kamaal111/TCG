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
import TCGSettings

public struct TCGScene: Scene {
    @State private var auth = KamaalAuth(
        client: TCGClient.default().auth,
        configuration: KamaalAuthConfiguration(
            appName: "TCG",
            storageNamespace: "\(Bundle.main.bundleIdentifier ?? "io.kamaal.TCG").TCGAuth"
        )
    )
    @State private var currencyState = TCGCurrency()
    @Environment(\.scenePhase) private var scenePhase
    @State private var cards = TCGCards.default()
    @State private var collections = TCGCollections(client: .default(), defaults: .standard)
    @State private var search = TCGSearch.default()

    public init() {}

    public var body: some Scene {
        WindowGroup {
            TabView {
                TCGCollectionsScreen()
                    .tabItem {
                        Label {
                            Text("Collections", bundle: .module)
                        } icon: {
                            Image(systemName: "square.stack")
                        }
                    }

                TCGSearchTab()
                    .tabItem { Label("Search", systemImage: "magnifyingglass") }

                #if !os(macOS)
                    NavigationStack { TCGAppSettings(cards: cards) }
                        .tabItem { Label("Settings", systemImage: "gearshape") }
                #endif
            }
            .environment(\.tcgCurrency, currencyState)
            .tcgCards(cards)
            .environment(\.tcgCollections, collections)
            .tcgSearch(search)
            .kamaalAuth(auth)
            .task { await currencyState.trackSession(auth) }
            .task { await collections.trackSession(auth, cards: cards) }
            .task(id: DisplayRefreshIdentity(display: currencyState.displayIdentity, isLoggedIn: auth.isLoggedIn)) {
                guard auth.isLoggedIn else {
                    cards.resetDisplayPrices()
                    search.resetDisplayPrices()
                    return
                }
                async let collection: Void = cards.refreshDisplayPrices(for: currencyState.displayIdentity)
                async let results: Void = search.refreshDisplayPrices(for: currencyState.displayIdentity)
                _ = await (collection, results)
            }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active, auth.isLoggedIn { Task { await currencyState.refresh() } }
            }
        }
        #if os(macOS)
            Settings {
                TCGAppSettings(cards: cards)
                    .tcgCards(cards)
                    .environment(\.tcgCollections, collections)
                    .environment(auth)
                    .environment(\.tcgCurrency, currencyState)
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

    private struct DisplayRefreshIdentity: Equatable {
        let display: TCGCurrency.DisplayIdentity
        let isLoggedIn: Bool
    }
}

private struct TCGSearchTab: View {
    @State private var selectedCard: PricedCard?

    var body: some View {
        NavigationStack {
            TCGSearchScreen { selectedCard = $0 }
        }
        .sheet(item: $selectedCard) { card in
            NavigationStack {
                TCGCardFormScreen(pricedCard: card)
            }
        }
    }
}

private struct TCGAppSettings: View {
    let cards: TCGCards
    @State private var importFile: ImportFile?

    var body: some View {
        TCGSettingsScreen(
            onExport: { await cards.exportCards() },
            onDownloadTemplate: { cards.downloadCardsTemplate() },
            onImport: { importFile = .init(url: $0) }
        )
        .sheet(item: $importFile) { file in
            TCGCardsImportReviewScreen(url: file.url).tcgCards(cards)
        }
    }

    private struct ImportFile: Identifiable {
        let id = UUID()
        let url: URL
    }
}
