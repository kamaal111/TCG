import SwiftUI
import TCGClient

struct CollectionSwitcher: View {
    @Environment(TCGCards.self) private var cards
    let collections: TCGCollections
    let actions: CollectionNavigationActions
    let wishlistSelection: Binding<Bool>?

    var body: some View {
        Menu {
            Button {
                wishlistSelection?.wrappedValue = false
                Task { await collections.select(nil, using: cards, loadsList: true) }
            } label: {
                Label {
                    Text("All cards", bundle: .module)
                } icon: {
                    Image(systemName: "rectangle.stack")
                }
            }
            if let wishlistSelection {
                Button {
                    wishlistSelection.wrappedValue = true
                } label: {
                    Label {
                        Text("Wishlist", bundle: .module)
                    } icon: {
                        Image(systemName: "heart")
                    }
                }
            }
            ForEach(collections.namedCollections) { collection in
                Button {
                    wishlistSelection?.wrappedValue = false
                    Task { await collections.select(collection.id, using: cards, loadsList: true) }
                } label: {
                    Label {
                        CollectionTitle(collection: collection)
                    } icon: {
                        Image(systemName: "rectangle.grid.3x2")
                    }
                }
            }
            if !cards.isReadOnly {
                Divider()
                Button {
                    wishlistSelection?.wrappedValue = false
                    actions.create()
                } label: {
                    Text("New collection", bundle: .module)
                }
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
