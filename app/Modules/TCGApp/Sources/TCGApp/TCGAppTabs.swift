import KamaalAuth
import SwiftUI
import TCGCards
import TCGClient
import TCGCurrency
import TCGSearch

struct TCGAppTabs: View {
    let auth: KamaalAuth
    let cards: TCGCards
    let collections: TCGCollections
    let currencyState: TCGCurrency
    let search: TCGSearch
    let wishlist: TCGWishlist?
    let offline: OfflineCollection
    @Environment(\.scenePhase) private var scenePhase
    @State private var selectedTab: AppTab = .collections

    private enum AppTab {
        case collections
        case search
        case settings
    }

    var body: some View {
        TabView(selection: $selectedTab) {
            collectionsTab
                .id(auth.session?.email)
                .tag(AppTab.collections)
                .tabItem {
                    Label {
                        Text("Collections", bundle: .module)
                    } icon: {
                        Image(systemName: "square.stack")
                    }
                }

            TCGSearchTab()
                .id(auth.session?.email)
                .tag(AppTab.search)
                .tabItem { Label("Search", systemImage: "magnifyingglass") }

            #if !os(macOS)
                NavigationStack { TCGAppSettings(cards: cards, offline: offline) }
                    .tag(AppTab.settings)
                    .tabItem { Label("Settings", systemImage: "gearshape") }
            #endif
        }
        .environment(\.tcgCurrency, currencyState)
        .tcgCards(cards)
        .environment(\.tcgCollections, collections)
        .tcgSearch(search)
        .environment(\.tcgWishlist, auth.isLoggedIn ? wishlist : nil)
        .kamaalAuth(auth)
        .task { await currencyState.trackSession(auth) }
        .task { await collections.trackSession(auth, cards: cards, offlineSeed: offline.cachedCollection) }
        .onDisappear { collections.stopLiveLoading(using: cards) }
        .task(id: DisplayRefreshIdentity(display: currencyState.displayIdentity, isLoggedIn: auth.isLoggedIn)) {
            await refreshDisplayPrices()
        }
        .task(id: scenePhase) {
            if scenePhase == .active, auth.isLoggedIn { await currencyState.refresh() }
        }
        .task(id: isCollectionVisible) {
            if isCollectionVisible { await collections.refreshOnForeground(using: cards) }
        }
    }

    @ViewBuilder
    private var collectionsTab: some View {
        if auth.isLoggedIn, let account = auth.session?.email, !collections.hasRestoredDestination(for: account) {
            ProgressView()
        } else if auth.isLoggedIn, wishlist != nil {
            TCGCollectionsScreen {
                TCGWishlistScreen(isVisible: selectedTab == .collections) { card, onAdded in
                    TCGCardFormScreen(pricedCard: card, onAdded: onAdded)
                }
            }
        } else {
            TCGCollectionsScreen()
        }
    }

    private var isCollectionVisible: Bool {
        selectedTab == .collections && scenePhase == .active && auth.isLoggedIn
    }

    private func refreshDisplayPrices() async {
        guard auth.isLoggedIn else {
            cards.resetDisplayPrices()
            search.resetDisplayPrices()
            return
        }
        async let collection: Void = cards.refreshDisplayPrices(
            for: currencyState.displayIdentity,
            refreshVisible: isCollectionVisible
        )
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
                TCGCardFormScreen(pricedCard: card, onAdded: onAdded)
            }
        }
    }
}
