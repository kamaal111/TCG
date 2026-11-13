import SwiftUI
import TCGDesignSystem

struct CardCollectionField: View {
    @Bindable var model: TCGCardFormScreenModel
    let collections: TCGCollections
    @State private var isCreating = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Picker(selection: selection) {
                if model.values.collectionID == nil && collections.unfiled == nil {
                    Text("Unfiled", bundle: .module).tag(UUID?.none)
                }
                ForEach(collections.collections) { collection in
                    CollectionTitle(collection: collection).tag(Optional(collection.id))
                }
            } label: {
                Text("Collection", bundle: .module)
            }
            .pickerStyle(.menu)
            if let error = model.fieldErrors[.collection] {
                TCGInlineError(error).font(.caption)
            }
            Button {
                isCreating = true
            } label: {
                Label {
                    Text("New collection…", bundle: .module)
                } icon: {
                    Image(systemName: "plus")
                }
            }
            .buttonStyle(.borderless)
            .help(Text("New collection", bundle: .module))
            .disabled(collections.isWorking)
        }
        .sheet(isPresented: $isCreating) {
            NavigationStack {
                NewCollectionScreen { name in
                    await model.createCollection(name: name, using: collections)
                }
            }
        }
    }

    private var selection: Binding<UUID?> {
        Binding(
            get: { model.values.collectionID ?? collections.unfiled?.id },
            set: { model.values.collectionID = $0 }
        )
    }
}
