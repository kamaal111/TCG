import SwiftUI
import TCGClient
import TCGDesignSystem

struct CollectionImportScreen: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(TCGCards.self) private var cards
    let backup: CollectionBackup
    let collections: TCGCollections
    @State private var isWorking = false
    @State private var error: String?
    @State private var preview: CollectionBackupPreview?
    @State private var completion: ImportCollectionBackupResult?

    var body: some View {
        Form {
            if let completion {
                Text(
                    "Imported \(completion.collectionCount) collections and \(completion.importedCount) new cards; updated \(completion.updatedCount) cards.",
                    bundle: .module
                )
            } else {
                CollectionBackupSummary(backup: backup)
                if let preview {
                    CollectionImportPreviewRows(preview: preview)
                } else if error == nil {
                    ProgressView()
                }
                Text(
                    "Previously exported or imported items are updated, including their layouts. Other cards and collections are kept. Empty pages and slot quantities are restored too.",
                    bundle: .module
                )
                if let error { TCGInlineError(error) }
                Button {
                    Task { await importBackup() }
                } label: {
                    Text("Import collections and cards", bundle: .module)
                }
                .disabled(isWorking || preview == nil)
                if isWorking { ProgressView() }
            }
        }
        .formStyle(.grouped)
        .navigationTitle(Text("Review backup", bundle: .module))
        .task {
            switch await collections.preview(backup) {
            case .success(let result): preview = result
            case .failure(let failure): error = failure.localizedDescription
            }
        }
        .toolbar {
            Button {
                dismiss()
            } label: {
                Text("Done", bundle: .module)
            }
            .disabled(isWorking)
        }
        .interactiveDismissDisabled(isWorking)
        .frame(minWidth: 300, minHeight: 350)
    }

    private func importBackup() async {
        isWorking = true
        defer { isWorking = false }
        switch await collections.importBackup(backup, using: cards) {
        case .success(let result): completion = result
        case .failure(let failure): error = failure.localizedDescription
        }
    }
}
