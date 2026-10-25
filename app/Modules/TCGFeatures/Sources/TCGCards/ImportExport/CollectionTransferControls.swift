import SwiftUI
import TCGClient
import UniformTypeIdentifiers

public struct CollectionTransferControls: View {
    @Environment(\.tcgCollections) private var collections
    @Environment(TCGCards.self) private var cards
    @State private var isExporting = false
    @State private var isImporting = false
    @State private var backup: CollectionBackup?
    @State private var error: String?

    public init() {}

    public var body: some View {
        Group {
            Button {
                isExporting = true
            } label: {
                Text("Export collections", bundle: .module)
            }
            .help(Text("Export collections", bundle: .module))
            Button {
                isImporting = true
            } label: {
                Text("Import collections", bundle: .module)
            }
            .help(Text("Import collections", bundle: .module))
        }
        .sheet(isPresented: $isExporting) {
            if let collections { NavigationStack { CollectionExportScreen(collections: collections) } }
        }
        .fileImporter(isPresented: $isImporting, allowedContentTypes: [.json]) { result in
            switch result {
            case .success(let url): openBackup(url)
            case .failure: error = Self.openBackupFailureMessage
            }
        }
        .sheet(isPresented: Binding(get: { backup != nil }, set: { if !$0 { backup = nil } })) {
            if let collections, let backup {
                NavigationStack { CollectionImportScreen(backup: backup, collections: collections) }.environment(cards)
            }
        }
        .alert(
            Text("Collection transfer", bundle: .module),
            isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })
        ) {
            Button {
                error = nil
            } label: {
                Text("OK", bundle: .module)
            }
        } message: {
            Text(error ?? "")
        }
    }

    private static var openBackupFailureMessage: String {
        String(
            localized: "The backup couldn’t be opened. Choose a complete collection backup and try again.",
            bundle: .module
        )
    }

    private func openBackup(_ url: URL) {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        let data: Data
        do { data = try Data(contentsOf: url) } catch _ {
            error = Self.openBackupFailureMessage
            return
        }
        switch CollectionBackupCoding.decode(data) {
        case .success(let decoded):
            guard decoded.version == CollectionBackup.currentVersion else {
                error = String(localized: "This backup version is not supported.", bundle: .module)
                return
            }
            backup = decoded
        case .failure: error = Self.openBackupFailureMessage
        }
    }
}
