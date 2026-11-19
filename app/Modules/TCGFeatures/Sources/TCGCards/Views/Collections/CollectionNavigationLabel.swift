import SwiftUI
import TCGClient

enum CollectionNavigationLabel: View {
    case system(SystemCollectionID)
    case named(CardCollectionSummary)

    var body: some View {
        Label {
            switch self {
            case .system(.allCards): Text("All cards", bundle: .module)
            case .system(.wishlist): Text("Wishlist", bundle: .module)
            case .named(let collection): CollectionTitle(collection: collection)
            }
        } icon: {
            Image(systemName: destination.systemImage)
        }
    }

    private var destination: CollectionDestination {
        switch self {
        case .system(let id): .system(id)
        case .named(let collection): .named(collection.id)
        }
    }
}
