import KamaalAuth
import SwiftUI
import TCGCards
import TCGCurrency
import TCGSearch

struct TCGAppTabs: View {
    let auth: KamaalAuth
    let cards: TCGCards
    let collections: TCGCollections
    let currencyState: TCGCurrency
    let search: TCGSearch
    let offline: OfflineCollection
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
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
                NavigationStack { TCGAppSettings(cards: cards, offline: offline) }
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
        .onDisappear { collections.stopLiveLoading(using: cards) }
        .task(id: DisplayRefreshIdentity(display: currencyState.displayIdentity, isLoggedIn: auth.isLoggedIn)) {
            await refreshDisplayPrices()
        }
        .task(id: scenePhase) {
            if scenePhase == .active, auth.isLoggedIn { await currencyState.refresh() }
        }
    }

    private func refreshDisplayPrices() async {
        guard auth.isLoggedIn else {
            cards.resetDisplayPrices()
            search.resetDisplayPrices()
            return
        }
        async let collection: Void = cards.refreshDisplayPrices(for: currencyState.displayIdentity)
        async let results: Void = search.refreshDisplayPrices(for: currencyState.displayIdentity)
        _ = await (collection, results)
    }

    private struct DisplayRefreshIdentity: Equatable {
        let display: TCGCurrency.DisplayIdentity
        let isLoggedIn: Bool
    }
}

private struct TCGSearchTab: View {
    var body: some View {
        NavigationStack {
            TCGSearchScreen { card, onAdded in
                NavigationStack {
                    TCGCardFormScreen(pricedCard: card, onAdded: onAdded)
                }
            }
        }
    }
}
