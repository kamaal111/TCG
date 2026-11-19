import Foundation

struct CollectionPreferences {
    private let defaults: UserDefaults?

    init(defaults: UserDefaults?) { self.defaults = defaults }

    func restoreDestination(account: String) -> CollectionDestination {
        guard let value = defaults?.string(forKey: destinationKey(account: account)) else { return .allCards }

        if value.hasPrefix("system:"), let id = SystemCollectionID(rawValue: String(value.dropFirst("system:".count))) {
            return .system(id)
        }
        if value.hasPrefix("named:"), let id = UUID(uuidString: String(value.dropFirst("named:".count))) {
            return .named(id)
        }
        return .allCards
    }

    func saveDestination(_ destination: CollectionDestination, account: String) {
        let value: String
        switch destination {
        case .system(let id): value = "system:\(id.rawValue)"
        case .named(let id): value = "named:\(id.uuidString)"
        }
        defaults?.set(value, forKey: destinationKey(account: account))
    }

    func restoreView(account: String, collectionID: UUID) -> CollectionViewMode? {
        defaults?.string(forKey: viewKey(account: account, collectionID: collectionID))
            .flatMap(CollectionViewMode.init(rawValue:))
    }

    func saveView(_ view: CollectionViewMode, account: String, collectionID: UUID) {
        defaults?.set(view.rawValue, forKey: viewKey(account: account, collectionID: collectionID))
    }

    private func destinationKey(account: String) -> String { "TCG.collections.destination.\(account)" }

    private func viewKey(account: String, collectionID: UUID) -> String {
        "TCG.collections.view.\(account).\(collectionID.uuidString)"
    }
}
