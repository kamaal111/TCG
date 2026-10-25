import SwiftUI
import TCGClient

struct CollectionExportSelection: View {
    let collections: [CardCollectionSummary]
    @Binding var selection: Set<UUID>

    var body: some View {
        ForEach(collections) { collection in
            Toggle(
                isOn: Binding(
                    get: { selection.contains(collection.id) },
                    set: { if $0 { selection.insert(collection.id) } else { selection.remove(collection.id) } }
                )
            ) {
                CollectionTitle(collection: collection)
            }
        }
    }
}
