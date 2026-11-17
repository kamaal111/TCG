import SwiftUI
import TCGClient

struct CollectionSidebar: View {
    private enum Selection: Hashable {
        case allCards
        case wishlist
        case collection(UUID)

        init(collectionID: UUID?) {
            if let collectionID { self = .collection(collectionID) } else { self = .allCards }
        }

        var collectionID: UUID? {
            switch self {
            case .allCards, .wishlist: nil
            case .collection(let id): id
            }
        }
    }

    @Environment(TCGCards.self) private var cards
    let collections: TCGCollections
    let hasWishlist: Bool
    @Binding var showsWishlist: Bool

    var body: some View {
        List(
            selection: Binding<Selection?>(
                get: { showsWishlist ? .wishlist : Selection(collectionID: collections.selectedID) },
                set: { selection in
                    showsWishlist = selection == .wishlist
                    if !showsWishlist {
                        Task { await collections.select(selection?.collectionID, using: cards, loadsList: true) }
                    }
                }
            )
        ) {
            Label {
                Text("All cards", bundle: .module)
            } icon: {
                Image(systemName: "rectangle.stack")
            }
            .tag(Selection.allCards)
            if hasWishlist {
                Label {
                    Text("Wishlist", bundle: .module)
                } icon: {
                    Image(systemName: "heart")
                }
                .tag(Selection.wishlist)
            }
            ForEach(collections.namedCollections) { collection in
                Label {
                    CollectionTitle(collection: collection)
                } icon: {
                    Image(systemName: "rectangle.grid.3x2")
                }
                .tag(Selection.collection(collection.id))
            }
        }
        .navigationTitle(Text("Collections", bundle: .module))
    }
}
