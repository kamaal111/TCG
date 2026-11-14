import SwiftUI
import TCGCards
import TCGDesignSystem
import TCGSettings

struct TCGAppSettings: View {
    let cards: TCGCards
    let offline: OfflineCollection
    @State private var importFile: ImportFile?

    var body: some View {
        TCGSettingsScreen(
            onExport: { await cards.exportCards() },
            onDownloadTemplate: { cards.downloadCardsTemplate() },
            onImport: { importFile = .init(url: $0) }
        )
        .offlineCollectionSettings {
            OfflineCollectionSettings(download: offline)
        } onSignOut: {
            offline.remove()
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
