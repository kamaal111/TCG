import Foundation

enum CollectionDestination: Hashable {
    case system(SystemCollectionID)
    case named(UUID)

    static let allCards = Self.system(.allCards)

    var namedID: UUID? {
        if case .named(let id) = self { return id }
        return nil
    }

    var systemImage: String {
        switch self {
        case .system(let id): id.systemImage
        case .named: "rectangle.grid.3x2"
        }
    }

    func available(in systemCollections: [SystemCollectionID]) -> Self {
        if case .system(let id) = self, !systemCollections.contains(id) { return .allCards }
        return self
    }
}

enum SystemCollectionID: String, Hashable {
    case allCards = "all-cards"
    case wishlist

    var systemImage: String {
        switch self {
        case .allCards: "rectangle.stack"
        case .wishlist: "heart"
        }
    }
}
