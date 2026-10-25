import SwiftUI
import TCGClient

struct CollectionSwitcher: View {
    @Environment(TCGCards.self) private var cards
    let collections: TCGCollections
    let actions: CollectionNavigationActions

    var body: some View {
        Menu {
            Button {
                Task { await collections.select(nil, using: cards) }
            } label: {
                Text("All cards", bundle: .module)
            }
            ForEach(collections.namedCollections) { collection in
                Button {
                    Task { await collections.select(collection.id, using: cards) }
                } label: {
                    CollectionTitle(collection: collection)
                }
            }
            Divider()
            Button {
                actions.create()
            } label: {
                Text("New collection", bundle: .module)
            }
        } label: {
            Label {
                Text("Collections", bundle: .module)
            } icon: {
                Image(systemName: "rectangle.stack")
            }
        }
        .help(Text("Choose a collection", bundle: .module))
    }
}
