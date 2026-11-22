import Foundation
import TCGClient
import TCGListSupport

@MainActor
final class CollectionSnapshotCache {
    struct Scope: Codable, Hashable, Sendable {
        var collectionID: UUID?
        var pageID: UUID?
        var game: ClientCardGame?
        var sets: [String] = []
        var illustrators: [String] = []
        var query: String?
        var revision: Int?

        static let allCards = Scope()
    }

    struct Page: Codable, Sendable {
        let scope: Scope
        var cards: [CardWithPrice]
        var checkedAt: Date?
        var list: ListState?
    }

    struct ListState: Codable, Sendable {
        let nextCursor: String?
        let visitedCursors: Set<String>
        let pageCount: Int
        let sets: Set<String>
        let illustrators: Set<String>
        let requiresPricing: Bool?
    }

    private struct VerifiedCard: Codable, Sendable {
        let row: CardWithPrice
        let checkedAt: Date
    }

    private struct Snapshot: Codable, Sendable {
        var summaries: [CardCollectionSummary] = []
        var selected: CardBinderCollection?
        var pages: [Page] = []
        var summariesCheckedAt: Date?
        var verifiedCards: [UUID: VerifiedCard]?
        var prices: [CollectionPricing.Key: OwnedCardPriceUpdate]?
    }

    private let store: AccountSnapshotStore<Snapshot>
    private var snapshot = Snapshot()
    private var account: String?

    var summaries: [CardCollectionSummary] { snapshot.summaries }
    var selected: CardBinderCollection? { snapshot.selected }

    func summariesAreFresh(at now: Date) -> Bool { CachedListLoad.isFresh(snapshot.summariesCheckedAt, at: now) }

    func saveSummaries(_ summaries: [CardCollectionSummary], checkedAt now: Date) {
        snapshot.summaries = summaries
        snapshot.summariesCheckedAt = now
        write()
    }

    func freshPage(for scope: Scope, at now: Date, force: Bool) -> Page? {
        snapshot.pages.first {
            $0.scope == scope && CachedListLoad.restoreWithoutFetching(checkedAt: $0.checkedAt, now: now, force: force)
        }
    }

    func verifiedCard(_ id: UUID, at now: Date) -> CardWithPrice? {
        guard let verified = snapshot.verifiedCards?[id], CachedListLoad.isFresh(verified.checkedAt, at: now) else {
            return nil
        }

        return verified.row
    }

    func verify(_ rows: [CardWithPrice], at now: Date, updating scope: Scope?) {
        let changedAliases = rows.compactMap { row -> String? in
            guard let alias = row.card.englishSearchAlias,
                alias != snapshot.verifiedCards?[row.card.id]?.row.card.englishSearchAlias
            else { return nil }
            return alias
        }
        if !changedAliases.isEmpty {
            for index in snapshot.pages.indices where snapshot.pages[index].scope != scope {
                if let query = snapshot.pages[index].scope.query,
                    changedAliases.contains(where: { $0.localizedStandardContains(query) })
                {
                    snapshot.pages[index].checkedAt = nil
                }
            }
        }
        var verified = (snapshot.verifiedCards ?? [:]).filter { CachedListLoad.isFresh($0.value.checkedAt, at: now) }
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

    static var defaultRoot: URL {
        URL.cachesDirectory.appending(path: "OnlineCollection-v1", directoryHint: .isDirectory)
    }

    init(root: URL) {
        store = AccountSnapshotStore(root: root, namespace: TCGClient.authenticationStorageNamespace)
    }

    func useAccount(_ account: String?) {
        guard account != self.account else { return }

        self.account = account
        snapshot = store.open(account: account) ?? Snapshot()
    }

    func rows(for scope: Scope) -> [CardWithPrice]? {
        snapshot.pages.first { $0.scope == scope }?.cards
    }

    func containsSnapshot(for account: String) -> Bool {
        store.containsSnapshot(for: account)
    }

    func startupRows(for account: String) async -> (cards: [CardWithPrice], collections: [CardBinderCollection])? {
        guard let saved = await store.read(account: account) else { return nil }

        var rows: [CardWithPrice] = []
        var positions: [UUID: Int] = [:]
        for page in saved.pages {
            for row in page.cards {
                if let index = positions[row.card.id] {
                    if row.card.updatedAt > rows[index].card.updatedAt { rows[index] = row }
                } else {
                    positions[row.card.id] = rows.count
                    rows.append(row)
                }
            }
        }
        guard !rows.isEmpty else { return nil }

        return (rows, saved.selected.map { [$0] } ?? [])
    }

    func save(_ cards: [CardWithPrice], for scope: Scope) {
        saveRead(cards, for: scope, checkedAt: nil, list: nil)
    }

    func saveRead(_ cards: [CardWithPrice], for scope: Scope, checkedAt: Date?, list: ListState?) {
        let previous = snapshot.pages.first { $0.scope == scope }
        let page = Page(
            scope: scope,
            cards: cards,
            checkedAt: checkedAt ?? previous?.checkedAt,
            list: list ?? previous?.list
        )
        CachedListLoad.store(page, in: &snapshot.pages, keyedBy: \.scope, keeping: .allCards)
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
        store.write(snapshot)
    }
}
