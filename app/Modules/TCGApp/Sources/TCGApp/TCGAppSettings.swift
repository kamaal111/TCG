import KamaalAuth
import SwiftUI
import TCGCards
import TCGCurrency
import TCGDesignSystem
import TCGSettings

struct TCGAppSettings: View {
    let cards: TCGCards
    let offline: OfflineCollection
    @Environment(KamaalAuth.self) private var auth
    @Environment(\.tcgCollections) private var collections
    @Environment(\.tcgCurrency) private var currency
    @State private var importFile: ImportFile?

    var body: some View {
        Group {
            if auth.isLoggedIn {
                TCGSettingsScreen(
                    showsSignOut: true,
                    onExport: { await cards.exportCards() },
                    onDownloadTemplate: { cards.downloadCardsTemplate() },
                    onImport: { importFile = .init(url: $0) }
                )
                .offlineCollectionSettings {
                    OfflineCollectionSettings(download: offline)
                } onSignOut: {
                    offline.remove()
                }
            } else {
                TCGSettingsScreen(showsSignOut: false, onExport: nil, onDownloadTemplate: nil, onImport: nil)
            }
        }
        .environment(\.tcgCollections, auth.isLoggedIn ? collections : nil)
        .environment(\.tcgCurrency, auth.isLoggedIn ? currency : nil)
        .onChange(of: auth.isLoggedIn) { _, loggedIn in
            if !loggedIn { importFile = nil }
        }
        .cardArtworkCacheSettings {
            CardArtworkCacheSettings()
        }
        .sheet(item: $importFile) { file in
            TCGCardsImportReviewScreen(url: file.url).tcgCards(cards)
        }
    }

    private struct ImportFile: Identifiable {
        let id = UUID()
        let url: URL
    }
}
