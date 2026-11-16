import CryptoKit
import Foundation
import TCGClient

@MainActor
final class CollectionSnapshotCache {
    struct Scope: Codable, Hashable {
        var collectionID: UUID?
        var pageID: UUID?
        var game: ClientCardGame?
        var sets: [String] = []
        var illustrators: [String] = []
        var query: String?
        var revision: Int?

        static let allCards = Scope()
    }

    struct Page: Codable {
        let scope: Scope
        var cards: [CardWithPrice]
        var checkedAt: Date?
        var list: ListState?
    }

    struct ListState: Codable {
        let nextCursor: String?
        let visitedCursors: Set<String>
        let pageCount: Int
        let sets: Set<String>
        let illustrators: Set<String>
        let requiresPricing: Bool?
    }

    private struct VerifiedCard: Codable {
        let row: CardWithPrice
        let checkedAt: Date
    }

    private struct Snapshot: Codable {
        var summaries: [CardCollectionSummary] = []
        var selected: CardBinderCollection?
        var pages: [Page] = []
        var summariesCheckedAt: Date?
        var verifiedCards: [UUID: VerifiedCard]?
        var prices: [CollectionPricing.Key: OwnedCardPriceUpdate]?
    }

    private let root: URL
    private var snapshot = Snapshot()
    private var file: URL?
    private var account: String?

    var summaries: [CardCollectionSummary] { snapshot.summaries }
    var selected: CardBinderCollection? { snapshot.selected }

    func summariesAreFresh(at now: Date) -> Bool { Self.isFresh(snapshot.summariesCheckedAt, at: now) }

    func stampSummaries(at now: Date) {
        snapshot.summariesCheckedAt = now
        write()
    }

    func freshPage(for scope: Scope, at now: Date) -> Page? {
        snapshot.pages.first { $0.scope == scope && Self.isFresh($0.checkedAt, at: now) }
    }

    func verifiedCard(_ id: UUID, at now: Date) -> CardWithPrice? {
        guard let verified = snapshot.verifiedCards?[id], Self.isFresh(verified.checkedAt, at: now) else { return nil }

        return verified.row
    }

    func verify(_ rows: [CardWithPrice], at now: Date) {
        var verified = (snapshot.verifiedCards ?? [:]).filter { Self.isFresh($0.value.checkedAt, at: now) }
        for row in rows { verified[row.card.id] = VerifiedCard(row: row, checkedAt: now) }
        snapshot.verifiedCards = verified
        write()
    }

    func invalidateReads() {
        snapshot.summariesCheckedAt = nil
        snapshot.verifiedCards = nil
        for index in snapshot.pages.indices { snapshot.pages[index].checkedAt = nil }
        write()
    }

    func price(for key: CollectionPricing.Key, on day: Date) -> OwnedCardPriceUpdate? {
        guard key.day == day else { return nil }

        return snapshot.prices?[key]
    }

    func savePrices(_ prices: [CollectionPricing.Key: OwnedCardPriceUpdate], on day: Date) {
        guard !prices.isEmpty else { return }

        var cached = (snapshot.prices ?? [:]).filter { $0.key.day == day }
        for (key, value) in prices { cached[key] = value }
        snapshot.prices = cached
        write()
    }

    private static func isFresh(_ checkedAt: Date?, at now: Date) -> Bool {
        guard let checkedAt else { return false }

        let age = now.timeIntervalSince(checkedAt)
        return age >= 0 && age < 15 * 60
    }

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
        saveRead(cards, for: scope, checkedAt: nil, list: nil)
    }

    func saveRead(_ cards: [CardWithPrice], for scope: Scope, checkedAt: Date?, list: ListState?) {
        let previous = snapshot.pages.first { $0.scope == scope }
        snapshot.pages.removeAll { $0.scope == scope }
        snapshot.pages.insert(
            Page(scope: scope, cards: cards, checkedAt: checkedAt ?? previous?.checkedAt, list: list ?? previous?.list),
            at: 0
        )
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
        snapshot.verifiedCards?.removeValue(forKey: id)
        snapshot.prices = snapshot.prices?.filter { $0.key.cardID != id }
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
