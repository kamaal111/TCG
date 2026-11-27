import KamaalAuth
import SwiftUI
import TCGCards
import TCGCurrency
import TCGDesignSystem
import TCGSettings

#if os(iOS)
    struct TCGAppSettingsSheet: ViewModifier {
        @Binding var isPresented: Bool
        let auth: KamaalAuth
        let cards: TCGCards
        let collections: TCGCollections
        let currency: TCGCurrency
        let offline: OfflineCollection

        func body(content: Content) -> some View {
            content
                .overlay(alignment: .topTrailing) {
                    if !auth.isLoggedIn {
                        TCGSettingsButton()
                            .labelStyle(.iconOnly)
                            .buttonStyle(SignedOutSettingsButtonStyle())
                            .padding(.trailing)
                    }
                }
                .environment(\.tcgSettingsPresentation, $isPresented)
                .sheet(isPresented: $isPresented) {
                    NavigationStack {
                        TCGAppSettings(cards: cards, offline: offline)
                            .toolbar {
                                ToolbarItem(placement: .cancellationAction) {
                                    Button {
                                        isPresented = false
                                    } label: {
                                        Text("Done", bundle: .module)
                                    }
                                }
                            }
                    }
                }
                .environment(auth)
                .tcgCards(cards)
                .environment(\.tcgCollections, collections)
                .environment(\.tcgCurrency, currency)
        }

        private struct SignedOutSettingsButtonStyle: ButtonStyle {
            func makeBody(configuration: Configuration) -> some View {
                configuration.label
                    .frame(minWidth: 44, minHeight: 44)
                    .contentShape(.rect)
                    .foregroundStyle(.tint)
                    .opacity(configuration.isPressed ? 0.65 : 1)
            }
        }
    }
#endif

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
