import SwiftUI
import TCGClient

public struct TCGCollectionsScreen: View {
    @Environment(\.tcgCollections) private var collections
    @Environment(TCGCards.self) private var cards
    @State private var name = ""
    @State private var isNaming = false
    @State private var isRenaming = false
    @State private var isDeleting = false
    @State private var isEditingLayout = false
    @State private var isEditingCollection = false

    public init() {}

    public var body: some View {
        Group {
            if let collections {
                #if os(macOS)
                    NavigationSplitView {
                        CollectionSidebar(collections: collections)
                    } detail: {
                        CollectionContentView(
                            collections: collections,
                            actions: navigationActions,
                            isEditing: $isEditingCollection
                        )
                    }
                #else
                    NavigationStack {
                        CollectionContentView(
                            collections: collections,
                            actions: navigationActions,
                            isEditing: $isEditingCollection
                        )
                    }
                #endif
            } else {
                ProgressView()
            }
        }
        .environment(\.isEditingCollection, isEditingCollection)
        .onChange(of: collections?.selectedID) {
            isEditingCollection = false
            isEditingLayout = false
            isNaming = false
            isDeleting = false
        }
        .safeAreaInset(edge: .bottom) {
            if cards.allocationAdjustments > 0 {
                CollectionAllocationNotice(
                    count: cards.allocationAdjustments,
                    dismiss: { cards.allocationAdjustments = 0 }
                )
            }
        }
        .alert(
            isRenaming ? Text("Rename collection", bundle: .module) : Text("New collection", bundle: .module),
            isPresented: $isNaming
        ) {
            TextField(text: $name) { Text("Name", bundle: .module) }
            Button {
                Task { await saveName() }
            } label: {
                Text("Save", bundle: .module)
            }
            .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            Button(role: .cancel) {
            } label: {
                Text("Cancel", bundle: .module)
            }
        }
        .confirmationDialog(
            Text("Delete this collection? Its cards will move to Unfiled.", bundle: .module),
            isPresented: $isDeleting,
            titleVisibility: .visible
        ) {
            Button(role: .destructive) {
                Task {
                    guard isEditingCollection else { return }
                    if let collections, let selected = collections.selected {
                        _ = await collections.delete(selected, using: cards)
                    }
                }
            } label: {
                Text("Delete collection", bundle: .module)
            }
        }
        .sheet(isPresented: $isEditingLayout) {
            if let collections, let selected = collections.selected {
                NavigationStack { BinderLayoutEditor(collection: selected, collections: collections) }
                    .environment(cards)
            }
        }
        .alert(
            Text("Collection unavailable", bundle: .module),
            isPresented: Binding(get: { collections?.error != nil }, set: { if !$0 { collections?.error = nil } })
        ) {
            Button {
                Task { await collections?.reload(using: cards) }
            } label: {
                Text("Refresh", bundle: .module)
            }
            Button(role: .cancel) {
                collections?.error = nil
            } label: {
                Text("Keep editing", bundle: .module)
            }
        } message: {
            Text(collections?.error?.localizedDescription ?? "")
        }
    }

    private var navigationActions: CollectionNavigationActions {
        .init(
            create: createCollection,
            rename: renameCollection,
            delete: { isDeleting = true },
            editLayout: { isEditingLayout = true }
        )
    }

    private func createCollection() {
        name = ""
        isRenaming = false
        isNaming = true
    }

    private func renameCollection(_ collection: CardBinderCollection) {
        guard isEditingCollection else { return }
        name = collection.name
        isRenaming = true
        isNaming = true
    }

    private func saveName() async {
        guard !isRenaming || isEditingCollection else { return }
        guard let collections else { return }
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if isRenaming, var collection = collections.selected {
            collection.name = trimmed
            _ = await collections.update(collection, using: cards)
        } else {
            _ = await collections.create(name: trimmed, using: cards)
        }
    }
}
