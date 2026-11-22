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
    let startup: StartupCollection
    let unlockCachedCards: () -> Void
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
                .tag(AppTab.collections)
                .tabItem {
                    Label {
                        Text("Collections", bundle: .module)
                    } icon: {
                        Image(systemName: "square.stack")
                    }
                }

            searchTab
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
        .environment(auth)
        .onChange(of: selectedTab, initial: true) { _, tab in
            startup.isCollectionsTabSelected = tab == .collections
        }
        .onChange(of: liveCollectionDisplayable) { _, ready in
            if ready { startup.dismiss() }
        }
        .onChange(of: auth.session?.email, initial: true) { _, _ in
            wishlist?.updateAccount()
        }
        .task { await currencyState.trackSession(auth) }
        .task { await collections.trackSession(auth, cards: cards, offlineSeed: collectionSeed) }
        .onDisappear { collections.stopLiveLoading(using: cards) }
        .task(id: DisplayRefreshIdentity(display: currencyState.displayIdentity, isLoggedIn: auth.isLoggedIn)) {
            await refreshDisplayPrices()
        }
        .task(id: scenePhase) {
            if scenePhase == .active, auth.isLoggedIn { await currencyState.refresh(locale: .current) }
        }
        .task(id: isCollectionVisible) {
            if isCollectionVisible { await collections.refreshOnForeground(using: cards) }
        }
    }

    private var collectionsTab: some View {
        liveCollections
            .id(auth.session?.email)
            .kamaalAuth(auth)
            .safeAreaInset(edge: .bottom) {
                if startup.account != nil, auth.initiallyValidatingToken, startup.preview == nil {
                    StartupCollectionUnlockControls(
                        isUnlocking: startup.isUnlocking,
                        needsUnlockHelp: startup.needsUnlockHelp,
                        unlock: unlockCachedCards
                    )
                    .padding()
                } else if offline.hasDownload, !auth.isLoggedIn, !auth.initiallyValidatingToken {
                    OfflineCollectionOpenButton(download: offline)
                        .padding()
                }
            }
            .allowsHitTesting(visibleStartupPreview == nil)
            .accessibilityHidden(visibleStartupPreview != nil)
            .overlay {
                if let preview = visibleStartupPreview {
                    StartupCollectionPreview(
                        preview: preview,
                        isCheckingSession: auth.initiallyValidatingToken,
                        dismiss: startup.dismiss
                    )
                }
            }
    }

    private var visibleStartupPreview: StartupCollection.Preview? {
        guard !liveCollectionDisplayable, let preview = startup.preview else { return nil }
        guard auth.session?.email == nil || auth.session?.email == preview.account else { return nil }

        return preview
    }

    private var liveCollectionDisplayable: Bool {
        guard let account = auth.session?.email else { return false }

        return collections.hasDisplayableDestination(for: account)
    }

    private var liveCollectionReady: Bool {
        guard let account = auth.session?.email else { return false }

        return collections.hasRestoredDestination(for: account)
    }

    @ViewBuilder
    private var liveCollections: some View {
        if auth.isLoggedIn, !liveCollectionReady {
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

    @ViewBuilder
    private var searchTab: some View {
        if auth.initiallyValidatingToken {
            ContentUnavailableView {
                Label {
                    Text("Card search", bundle: .module)
                } icon: {
                    Image(systemName: "magnifyingglass")
                }
            } description: {
                Text("Search will be available after sign-in.", bundle: .module)
            }
        } else {
            TCGSearchTab().kamaalAuth(auth)
        }
    }

    private func collectionSeed(for account: String) -> (cards: [CardWithPrice], collections: [CardBinderCollection]) {
        if let preview = startup.preview, preview.account == account {
            return (preview.cards, preview.collections)
        }

        return offline.cachedCollection(for: account)
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
