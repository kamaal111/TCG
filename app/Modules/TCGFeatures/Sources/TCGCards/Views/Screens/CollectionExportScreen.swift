import SwiftUI
import TCGClient
import TCGDesignSystem

struct CollectionExportScreen: View {
    @Environment(\.dismiss) private var dismiss
    let collections: TCGCollections
    @State private var selection: Set<UUID> = []
    @State private var document: CollectionBackupDocument?
    @State private var isSaving = false
    @State private var isWorking = false
    @State private var error: String?

    var body: some View {
        Form {
            Button {
                selection = Set(collections.collections.map(\.id))
            } label: {
                Text("Select all", bundle: .module)
            }
            CollectionExportSelection(collections: collections.collections, selection: $selection)
            Text("Each selected collection includes its cards, purchases, layout, and empty pages.", bundle: .module)
                .foregroundStyle(.secondary)
            Text("Large backups may require increased server limits to import.", bundle: .module)
                .foregroundStyle(.secondary)
            if isWorking { ProgressView() }
            if let error { TCGInlineError(error) }
        }
        .formStyle(.grouped)
        .navigationTitle(Text("Export collections", bundle: .module))
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button {
                    dismiss()
                } label: {
                    Text("Cancel", bundle: .module)
                }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button {
                    Task { await export() }
                } label: {
                    Text("Export", bundle: .module)
                }
                .disabled(selection.isEmpty || isWorking)
            }
        }
        .onAppear { selection = Set(collections.collections.map(\.id)) }
        .fileExporter(
            isPresented: $isSaving,
            document: document,
            contentType: .json,
            defaultFilename: "tcg-collections"
        ) { result in
            switch result {
            case .success: dismiss()
            case .failure: error = String(localized: "The backup couldn’t be saved. Please try again.", bundle: .module)
            }
        }
        .frame(minWidth: 300, minHeight: 350)
    }

    private func export() async {
        isWorking = true
        defer { isWorking = false }
        switch await collections.export(
            ids: selection == Set(collections.collections.map(\.id)) ? nil : Array(selection)
        )
        {
        case .failure(let failure): error = failure.localizedDescription
        case .success(let backup):
            switch CollectionBackupCoding.encode(backup) {
            case .success(let data):
                document = CollectionBackupDocument(data: data)
                isSaving = true
            case .failure:
                error = String(localized: "The backup couldn’t be prepared. Please try again.", bundle: .module)
            }
        }
    }
}
