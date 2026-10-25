import Foundation

struct CollectionPreferences {
    private let defaults: UserDefaults?

    init(defaults: UserDefaults?) { self.defaults = defaults }

    func restore(account: String) -> UUID? {
        defaults?.string(forKey: selectionKey(account: account)).flatMap(UUID.init(uuidString:))
    }

    func save(_ collectionID: UUID?, account: String) {
        defaults?.set(collectionID?.uuidString, forKey: selectionKey(account: account))
    }

    func restoreView(account: String, collectionID: UUID) -> CollectionViewMode? {
        defaults?.string(forKey: viewKey(account: account, collectionID: collectionID))
            .flatMap(CollectionViewMode.init(rawValue:))
    }

    func saveView(_ view: CollectionViewMode, account: String, collectionID: UUID) {
        defaults?.set(view.rawValue, forKey: viewKey(account: account, collectionID: collectionID))
    }

    private func selectionKey(account: String) -> String { "TCG.collections.last.\(account)" }

    private func viewKey(account: String, collectionID: UUID) -> String {
        "TCG.collections.view.\(account).\(collectionID.uuidString)"
    }
}
