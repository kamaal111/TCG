import KamaalAuth
import SwiftUI
import TCGCards
import TCGClient
import TCGCurrency

@MainActor
enum SettingsLayout {
    struct Section: Identifiable {
        enum ID: Hashable {
            case privacy, artworkCache, offlineCollection, currency, collections, data, about, signOut
        }

        enum Content {
            case group(Group)
            case embedded
        }

        struct Group {
            let header: Text?
            let footer: Text?
            let rows: [Row]
            var isDisabled = false
        }

        let id: ID
        let content: Content
    }

    struct Row: Identifiable {
        enum ID: Hashable {
            case hidePrices, artworkCache, preferredCurrency, collectionTransfer
            case exportCards, importCards, transferProgress, appLogs, version, signOut
        }

        enum Content {
            case pricePrivacy(TCGPricePrivacy)
            case artworkCache
            case preferredCurrency(TCGCurrency)
            case collectionTransfer
            case button(Text, action: () -> Void)
            case sheet(Text, Sheet)
            case transferProgress
            case version(String)
            case signOut(SessionEnd)
        }

        let id: ID
        let content: Content
    }

    enum Sheet {
        case appLogs(KamaalAuth)
        case importCards(CardTransfer)
    }

    struct CardTransfer {
        let isWorking: Bool
        let export: () -> Void
        let downloadTemplate: () -> Void
        let chooseFile: () -> Void
    }

    struct SessionEnd {
        let isDisabled: Bool
        let action: () -> Void
    }

    static func form<Artwork: View, Offline: View>(
        auth: KamaalAuth,
        pricePrivacy: TCGPricePrivacy?,
        artworkCache: Artwork?,
        offlineCollection: Offline?,
        currency: TCGCurrency?,
        showsCollectionTransfer: Bool,
        cardTransfer: CardTransfer?,
        versionText: String?,
        sessionEnd: SessionEnd?
    ) -> some View {
        let sections: [Section?] = [
            pricePrivacy.map(privacySection),
            artworkCache.map { _ in
                Section(
                    id: .artworkCache,
                    content: .group(
                        .init(header: nil, footer: nil, rows: [Row(id: .artworkCache, content: .artworkCache)])
                    )
                )
            },
            offlineCollection.map { _ in Section(id: .offlineCollection, content: .embedded) },
            currency.map(currencySection),
            showsCollectionTransfer ? collectionTransferSection : nil,
            cardTransfer.map(dataSection),
            aboutSection(auth: auth, versionText: versionText),
            sessionEnd.map(signOutSection),
        ]

        return SettingsForm(sections: sections.compactMap { $0 }) { row in
            rowContent(row, artworkCache: artworkCache)
        } embedded: {
            offlineCollection
        }
    }

    private static func privacySection(_ privacy: TCGPricePrivacy) -> Section {
        Section(
            id: .privacy,
            content: .group(
                .init(
                    header: Text("Privacy", bundle: .module),
                    footer: Text(
                        "Hide prices and financial changes while browsing. Card quantities stay visible. Prices remain visible when adding or editing cards.",
                        bundle: .module
                    ),
                    rows: [Row(id: .hidePrices, content: .pricePrivacy(privacy))]
                )
            )
        )
    }

    private static func currencySection(_ currency: TCGCurrency) -> Section {
        Section(
            id: .currency,
            content: .group(
                .init(
                    header: nil,
                    footer: Text(
                        "Used throughout the app. You can choose a different currency for each purchase.",
                        bundle: .module
                    ),
                    rows: [Row(id: .preferredCurrency, content: .preferredCurrency(currency))]
                )
            )
        )
    }

    private static var collectionTransferSection: Section {
        Section(
            id: .collections,
            content: .group(
                .init(
                    header: Text("Collections and layouts", bundle: .module),
                    footer: nil,
                    rows: [Row(id: .collectionTransfer, content: .collectionTransfer)]
                )
            )
        )
    }

    private static func dataSection(_ transfer: CardTransfer) -> Section {
        var rows = [
            Row(id: .exportCards, content: .button(Text("Export Cards", bundle: .module), action: transfer.export)),
            Row(id: .importCards, content: .sheet(Text("Import Cards", bundle: .module), .importCards(transfer))),
        ]
        if transfer.isWorking {
            rows.append(Row(id: .transferProgress, content: .transferProgress))
        }
        return Section(
            id: .data,
            content: .group(
                .init(
                    header: Text("Data", bundle: .module),
                    footer: Text(
                        "Export your entire collection to CSV, or review and import cards from a CSV file.",
                        bundle: .module
                    ),
                    rows: rows,
                    isDisabled: transfer.isWorking
                )
            )
        )
    }

    private static func aboutSection(auth: KamaalAuth, versionText: String?) -> Section? {
        var rows: [Row] = []
        if auth.isLoggedIn {
            rows.append(Row(id: .appLogs, content: .sheet(Text("App Logs", bundle: .module), .appLogs(auth))))
        }
        if let versionText {
            rows.append(Row(id: .version, content: .version(versionText)))
        }
        guard !rows.isEmpty else { return nil }
        return Section(
            id: .about,
            content: .group(.init(header: Text("About", bundle: .module), footer: nil, rows: rows))
        )
    }

    private static func signOutSection(_ sessionEnd: SessionEnd) -> Section {
        Section(
            id: .signOut,
            content: .group(
                .init(
                    header: nil,
                    footer: nil,
                    rows: [Row(id: .signOut, content: .signOut(sessionEnd))]
                )
            )
        )
    }

    @ViewBuilder
    private static func rowContent<Artwork: View>(_ row: Row, artworkCache: Artwork?) -> some View {
        switch row.content {
        case .pricePrivacy(let privacy):
            Toggle(isOn: Binding(get: { privacy.hidePrices }, set: { privacy.hidePrices = $0 })) {
                Text("Hide prices", bundle: .module)
            }
        case .artworkCache:
            artworkCache
        case .preferredCurrency(let currency):
            currencyPicker(currency)
        case .collectionTransfer:
            CollectionTransferControls()
        case .button(let title, let action):
            Button(action: action) { title }
        case .sheet(let title, let sheet):
            SettingsSheetButton(title: title) { isPresented in
                sheetContent(sheet, isPresented: isPresented)
            }
        case .transferProgress:
            ProgressView()
        case .version(let version):
            LabeledContent {
                Text(version)
                    .textSelection(.enabled)
            } label: {
                Text("Version", bundle: .module)
            }
        case .signOut(let sessionEnd):
            SignOutSettingsButton(isDisabled: sessionEnd.isDisabled, action: sessionEnd.action)
        }
    }

    @ViewBuilder
    private static func currencyPicker(_ currency: TCGCurrency) -> some View {
        Picker(
            selection: Binding(
                get: { currency.preferredCurrency },
                set: { selected in
                    Task { await currency.save(selected) }
                }
            )
        ) {
            ForEach(Currency.allCases, id: \.self) { option in
                Text(verbatim: option.rawValue).tag(option)
            }
        } label: {
            Text("Preferred currency", bundle: .module)
        }
        .disabled(currency.isSaving || !currency.preferenceLoaded)
        if currency.isSaving { ProgressView() }
        if currency.saveFailed {
            Text("Couldn’t save your currency. Please try again.", bundle: .module)
                .foregroundStyle(.red)
        }
    }

    @ViewBuilder
    private static func sheetContent(_ sheet: Sheet, isPresented: Binding<Bool>) -> some View {
        switch sheet {
        case .appLogs(let auth):
            if auth.isLoggedIn { TCGAppLogsScreen() }
        case .importCards(let transfer):
            let close = { isPresented.wrappedValue = false }
            TCGCSVImportIntroduction(
                onDownloadTemplate: {
                    close()
                    transfer.downloadTemplate()
                },
                onChooseFile: {
                    close()
                    transfer.chooseFile()
                },
                onClose: close
            )
        }
    }
}

private struct SettingsForm<RowContent: View, Embedded: View>: View {
    let sections: [SettingsLayout.Section]
    @ViewBuilder let row: (SettingsLayout.Row) -> RowContent
    @ViewBuilder let embedded: () -> Embedded

    var body: some View {
        Form {
            ForEach(sections) { section in
                switch section.content {
                case .embedded:
                    embedded()
                case .group(let group):
                    Section {
                        ForEach(group.rows) { row($0) }
                    } header: {
                        group.header
                    } footer: {
                        group.footer
                    }
                    .disabled(group.isDisabled)
                }
            }
        }
        .formStyle(.grouped)
    }
}

private struct SettingsSheetButton<Destination: View>: View {
    @State private var isPresented = false

    let title: Text
    @ViewBuilder let destination: (Binding<Bool>) -> Destination

    var body: some View {
        Button {
            isPresented = true
        } label: {
            title
        }
        .sheet(isPresented: $isPresented) {
            destination($isPresented)
        }
    }
}

private struct SignOutSettingsButton: View {
    @State private var isConfirming = false
    let isDisabled: Bool
    let action: () -> Void

    var body: some View {
        Button(role: .destructive, action: { isConfirming = true }) {
            Text("Sign Out", bundle: .module)
                .fontWeight(.bold)
                .foregroundStyle(.red)
                .frame(maxWidth: .infinity)
        }
        #if os(macOS)
            .buttonStyle(.borderless)
        #endif
        .disabled(isDisabled)
        .confirmationDialog(
            Text("Sign out of Mintomo?", bundle: .module),
            isPresented: $isConfirming,
            titleVisibility: .visible
        ) {
            Button(role: .destructive, action: action) {
                Text("Sign Out", bundle: .module)
            }
        }
    }
}
