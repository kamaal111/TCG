import SwiftUI
import TCGClient
import TCGDesignSystem

struct BinderLayoutEditor: View {
    @Environment(TCGCards.self) private var cards
    @Environment(\.dismiss) private var dismiss
    let collection: CardBinderCollection
    let collections: TCGCollections
    @State private var columns: String
    @State private var rows: String
    @State private var preview: CardBinderCollection?
    @State private var saveError: CollectionsError?
    @State private var isConfirmingResize = false

    init(collection: CardBinderCollection, collections: TCGCollections) {
        self.collection = collection
        self.collections = collections
        _columns = State(initialValue: String(collection.columns))
        _rows = State(initialValue: String(collection.rows))
    }

    var body: some View {
        Form {
            Section {
                BinderDimensionFields(columns: $columns, rows: $rows) { size in
                    columns = String(size)
                    rows = String(size)
                    preview = nil
                }
                Button {
                    if let dimensions {
                        preview = BinderLayout.resized(collection, columns: dimensions.columns, rows: dimensions.rows)
                    }
                } label: {
                    Text("Preview layout", bundle: .module)
                }
                .disabled(dimensions == nil)
            } footer: {
                Text(
                    "Choose between 1 and \(BinderLayout.maximumDimension) columns and rows. Cards that no longer fit move to extra pages; gaps are preserved.",
                    bundle: .module
                )
            }
            if let preview {
                BinderLayoutPreview(originalPageCount: collection.pages.count, preview: preview)
                Button {
                    if BinderLayout.requiresResizeConfirmation(from: collection, to: preview) {
                        isConfirmingResize = true
                    } else {
                        Task { await apply(preview) }
                    }
                } label: {
                    Text("Apply layout", bundle: .module)
                }
                .disabled(collections.isWorking)
            }
            if let saveError { TCGInlineError(saveError.localizedDescription) }
        }
        .formStyle(.grouped)
        .navigationTitle(Text("Page dimensions", bundle: .module))
        .toolbar {
            Button {
                dismiss()
            } label: {
                Text("Cancel", bundle: .module)
            }
        }
        .confirmationDialog(
            Text("Change page dimensions?", bundle: .module),
            isPresented: $isConfirmingResize,
            titleVisibility: .visible,
            presenting: preview
        ) { preview in
            Button {
                Task { await apply(preview) }
            } label: {
                Text("Apply layout", bundle: .module)
            }
            .disabled(collections.isWorking)
            Button(role: .cancel) {
            } label: {
                Text("Keep current layout", bundle: .module)
            }
        } message: { _ in
            Text(
                "Cards that no longer fit will move to extra pages. Your cards and purchases will be kept.",
                bundle: .module
            )
        }
        .onChange(of: columns) { preview = nil }
        .onChange(of: rows) { preview = nil }
        .frame(minWidth: 300, minHeight: 400)
    }

    private func apply(_ preview: CardBinderCollection) async {
        if await collections.save(preview, using: cards) {
            dismiss()
        } else {
            saveError = collections.error
        }
    }

    private var dimensions: (columns: Int, rows: Int)? {
        guard let columns = Int(columns) else { return nil }
        guard let rows = Int(rows) else { return nil }
        guard BinderLayout.capacity(columns: columns, rows: rows) != nil else { return nil }
        return (columns, rows)
    }
}
