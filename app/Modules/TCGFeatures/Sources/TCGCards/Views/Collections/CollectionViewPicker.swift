import SwiftUI
import TCGClient

struct CollectionViewPicker: View {
    let collection: CardBinderCollection
    let collections: TCGCollections

    var body: some View {
        Picker(selection: selection) {
            Text("Binder", bundle: .module).tag(CollectionViewMode.binder)
            Text("List", bundle: .module).tag(CollectionViewMode.list)
        } label: {
            Text("Collection view", bundle: .module)
        }
        .pickerStyle(.segmented)
    }

    private var selection: Binding<CollectionViewMode> {
        Binding(
            get: { collections.view(for: collection.id) },
            set: { collections.setView($0, for: collection.id) }
        )
    }
}
