import SwiftUI
import TCGClient
import TCGDesignSystem

struct CollectionSwitcher: View {
    @Environment(TCGCards.self) private var cards
    let collections: TCGCollections
    let actions: CollectionNavigationActions
    let wishlistSelection: Binding<Bool>?

    private enum DestinationIcon: String {
        case allCards = "rectangle.stack"
        case wishlist = "heart"
        case namedCollection = "rectangle.grid.3x2"
    }

    private var selectedIcon: DestinationIcon {
        if wishlistSelection?.wrappedValue == true { return .wishlist }
        return collections.selectedID == nil ? .allCards : .namedCollection
    }

    var body: some View {
        TCGNavigationMenu {
            Button {
                wishlistSelection?.wrappedValue = false
                Task { await collections.select(nil, using: cards, loadsList: true) }
            } label: {
                Label {
                    Text("All cards", bundle: .module)
                } icon: {
                    Image(systemName: DestinationIcon.allCards.rawValue)
                }
            }
            if let wishlistSelection {
                Button {
                    wishlistSelection.wrappedValue = true
                } label: {
                    Label {
                        Text("Wishlist", bundle: .module)
                    } icon: {
                        Image(systemName: DestinationIcon.wishlist.rawValue)
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
                        Image(systemName: DestinationIcon.namedCollection.rawValue)
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
                Image(systemName: selectedIcon.rawValue)
            }
        }
        .help(Text("Choose a collection", bundle: .module))
    }
}
