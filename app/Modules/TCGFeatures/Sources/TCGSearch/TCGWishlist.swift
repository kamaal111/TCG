import Foundation
import Observation
import SwiftUI
import TCGClient
import TCGListSupport

@MainActor
@Observable
public final class TCGWishlist {
    struct Snapshot: Codable {
        let query: String?
        var entries: [PricedCard]
        let pagination: CursorPagination
        var checkedAt: Date?
        let currency: Currency?
        var version = UUID()
    }

    struct ReadContext: Equatable {
        let session: UUID
        let revision: UUID
    }

    private let client: TCGWishlistClient
    private let accountID: (() -> String?)?
    private let store: AccountSnapshotStore<[Snapshot]>?
    let now: () -> Date

    @ObservationIgnored private var account: String?
    @ObservationIgnored private var session = UUID()
    @ObservationIgnored private var snapshots: [Snapshot] = []
    private(set) var revision = UUID()

    public convenience init(client: TCGWishlistClient, accountID: (() -> String?)? = nil) {
        self.init(
            client: client,
            accountID: accountID,
            cacheRoot: .cachesDirectory.appending(path: "Wishlist-v1", directoryHint: .isDirectory),
            now: { .now }
        )
    }

    init(client: TCGWishlistClient, accountID: (() -> String?)?, cacheRoot: URL, now: @escaping () -> Date) {
        self.client = client
        self.accountID = accountID
        self.now = now
        store = accountID.map { _ in
            AccountSnapshotStore(root: cacheRoot, namespace: TCGClient.authenticationStorageNamespace)
        }
    }

    public func updateAccount() {
        let current = accountID?()
        guard current != account else { return }

        account = current
        session = UUID()
        snapshots = store?.open(account: current) ?? []
    }

    func readContext() -> ReadContext? {
        updateAccount()
        guard accountID == nil || account != nil else { return nil }
        return ReadContext(session: session, revision: revision)
    }

    func snapshot(for query: String?) -> Snapshot? {
        snapshots.first { $0.query == query }
    }

    func saveSnapshot(_ snapshot: Snapshot, replacing version: UUID?) -> Bool {
        guard store != nil, self.snapshot(for: snapshot.query)?.version == version else { return false }
        CachedListLoad.store(snapshot, in: &snapshots, keyedBy: \.query, keeping: nil)
        store?.write(snapshots)
        return true
    }

    func clearSnapshots() {
        snapshots = []
        store?.write(snapshots)
    }

    func page(after cursor: String?, query: String?) async -> Result<WishlistPage, WishlistError> {
        await client.list(cursor: cursor, query: query)
    }

    func save(pricedCardID: String) async -> Result<Void, WishlistError> {
        guard let context = readContext() else { return .failure(.unauthorized) }
        let result = await client.save(.init(pricedCardID: pricedCardID))
        guard readContext()?.session == context.session else { return .failure(.unauthorized) }
        if case .success = result { invalidateSnapshots(removedPrinting: nil) }
        return result
    }

    func remove(printingKey: String) async -> Result<Void, WishlistError> {
        guard let context = readContext() else { return .failure(.unauthorized) }
        let result = await client.remove(printingKey: printingKey)
        guard readContext()?.session == context.session else { return .failure(.unauthorized) }
        if case .success = result { invalidateSnapshots(removedPrinting: printingKey) }
        return result
    }

    private func invalidateSnapshots(removedPrinting: String?) {
        for index in snapshots.indices {
            snapshots[index].checkedAt = nil
            snapshots[index].version = UUID()
            if let removedPrinting {
                snapshots[index].entries.removeAll { $0.printingKey == removedPrinting }
            }
        }
        store?.write(snapshots)
        revision = UUID()
    }
}

extension EnvironmentValues {
    @Entry public var tcgWishlist: TCGWishlist? = nil
}
