import CryptoKit
import Foundation
import TCGClient

@MainActor
final class CollectionSnapshotCache {
    struct Scope: Codable, Equatable {
        var collectionID: UUID?
        var pageID: UUID?
        var game: ClientCardGame?
        var sets: [String] = []
        var illustrators: [String] = []
        var query: String?

        static let allCards = Scope()
    }

    struct Page: Codable {
        let scope: Scope
        var cards: [CardWithPrice]
    }

    private struct Snapshot: Codable {
        var summaries: [CardCollectionSummary] = []
        var selected: CardBinderCollection?
        var pages: [Page] = []
    }

    private let root: URL
    private var snapshot = Snapshot()
    private var file: URL?
    private var account: String?

    var summaries: [CardCollectionSummary] { snapshot.summaries }
    var selected: CardBinderCollection? { snapshot.selected }

    init(root: URL = URL.cachesDirectory.appending(path: "OnlineCollection-v1", directoryHint: .isDirectory)) {
        self.root = root
    }

    func useAccount(_ account: String?) {
        guard account != self.account else { return }

        self.account = account
        snapshot = Snapshot()
        file = nil
        guard let account, let directory = try? prepareDirectory() else { return }

        let identity = "\(TCGClient.authenticationStorageNamespace)|\(account)"
        let key = SHA256.hash(data: Data(identity.utf8)).map { String(format: "%02x", $0) }.joined()
        let file = directory.appending(path: "\(key).json")
        self.file = file
        if let data = try? Data(contentsOf: file),
            let decoded = try? JSONDecoder().decode(Snapshot.self, from: data)
        {
            snapshot = decoded
        }
    }

    func rows(for scope: Scope) -> [CardWithPrice]? {
        snapshot.pages.first { $0.scope == scope }?.cards
    }

    func save(_ cards: [CardWithPrice], for scope: Scope) {
        snapshot.pages.removeAll { $0.scope == scope }
        snapshot.pages.insert(Page(scope: scope, cards: cards), at: 0)
        let limit = snapshot.pages.contains(where: { $0.scope == .allCards }) ? 9 : 8
        if snapshot.pages.count > limit, let last = snapshot.pages.lastIndex(where: { $0.scope != .allCards }) {
            snapshot.pages.remove(at: last)
        }
        write()
    }

    func saveCollections(_ summaries: [CardCollectionSummary], selected: CardBinderCollection?) {
        snapshot.summaries = summaries
        snapshot.selected = selected
        write()
    }

    func removeCard(_ id: UUID) {
        for index in snapshot.pages.indices {
            snapshot.pages[index].cards.removeAll { $0.card.id == id }
        }
        write()
    }

    func removeCollection(_ id: UUID) {
        snapshot.pages.removeAll { $0.scope.collectionID == id }
        write()
    }

    private func write() {
        guard let file, let data = try? JSONEncoder().encode(snapshot) else { return }

        #if os(iOS)
            try? data.write(to: file, options: [.atomic, .completeFileProtection])
        #else
            try? data.write(to: file, options: .atomic)
        #endif
    }

    private func prepareDirectory() throws -> URL {
        var directory = root
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var resources = URLResourceValues()
        resources.isExcludedFromBackup = true
        try directory.setResourceValues(resources)
        return directory
    }
}
