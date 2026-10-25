import SwiftUI
import TCGClient

struct CollectionSidebar: View {
    private enum Selection: Hashable {
        case allCards
        case collection(UUID)

        init(collectionID: UUID?) {
            if let collectionID { self = .collection(collectionID) } else { self = .allCards }
        }

        var collectionID: UUID? {
            switch self {
            case .allCards: nil
            case .collection(let id): id
            }
        }
    }

    @Environment(TCGCards.self) private var cards
    let collections: TCGCollections

    var body: some View {
        List(
            selection: Binding<Selection?>(
                get: { Selection(collectionID: collections.selectedID) },
                set: { id in Task { await collections.select(id?.collectionID, using: cards) } }
            )
        ) {
            Label {
                Text("All cards", bundle: .module)
            } icon: {
                Image(systemName: "rectangle.stack")
            }
            .tag(Selection.allCards)
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
