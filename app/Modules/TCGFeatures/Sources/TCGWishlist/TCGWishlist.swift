import Foundation
import Observation
import SwiftUI
import TCGClient
import TCGListSupport

@MainActor
@Observable
public final class TCGWishlist {
    package struct Snapshot: Codable {
        let query: String?
        let game: ClientCardGame?
        let setNames: Set<String>?
        let illustrators: Set<String>?
        package let availableSetNames: Set<String>?
        package let availableIllustrators: Set<String>?
        package var entries: [PricedCard]
        package let pagination: CursorPagination
        package var checkedAt: Date?
        package let currency: Currency?
        package var version: UUID

        package init(
            filters: CardListFilters,
            availableSetNames: Set<String>?,
            availableIllustrators: Set<String>?,
            entries: [PricedCard],
            pagination: CursorPagination,
            checkedAt: Date?,
            currency: Currency?,
            version: UUID
        ) {
            query = filters.query
            game = filters.game
            setNames = filters.setNames
            illustrators = filters.illustrators
            self.availableSetNames = availableSetNames
            self.availableIllustrators = availableIllustrators
            self.entries = entries
            self.pagination = pagination
            self.checkedAt = checkedAt
            self.currency = currency
            self.version = version
        }

        var filters: CardListFilters {
            .init(game: game, setNames: setNames ?? [], illustrators: illustrators ?? [], query: query)
        }
    }

    package struct ReadContext: Equatable {
        let session: UUID
        let revision: UUID
    }

    private let client: TCGWishlistClient
    private let accountID: (() -> String?)?
    private let store: AccountSnapshotStore<[Snapshot]>?
    package let now: () -> Date

    @ObservationIgnored private var account: String?
    @ObservationIgnored private var session = UUID()
    @ObservationIgnored private var snapshots: [Snapshot] = []
    package private(set) var revision = UUID()

    public convenience init(client: TCGWishlistClient, accountID: (() -> String?)?) {
        self.init(
            client: client,
            accountID: accountID,
            cacheRoot: .cachesDirectory.appending(path: "Wishlist-v1", directoryHint: .isDirectory),
            now: { .now }
        )
    }

    package init(client: TCGWishlistClient, accountID: (() -> String?)?, cacheRoot: URL, now: @escaping () -> Date) {
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

    package func readContextAfterAccountSync() -> ReadContext? {
        updateAccount()
        guard accountID == nil || account != nil else { return nil }
        return ReadContext(session: session, revision: revision)
    }

    package func snapshot(for filters: CardListFilters) -> Snapshot? {
        snapshots.first { $0.filters == filters }
    }

    package func saveSnapshot(_ snapshot: Snapshot, replacing version: UUID?) -> Bool {
        guard store != nil, self.snapshot(for: snapshot.filters)?.version == version else { return false }
        CachedListLoad.store(snapshot, in: &snapshots, keyedBy: \.filters, keeping: .unfiltered)
        store?.write(snapshots)
        return true
    }

    package func clearSnapshots() {
        snapshots = []
        store?.write(snapshots)
    }

    package func page(_ request: WishlistListQuery) async -> Result<WishlistPage, WishlistError> {
        await client.list(request)
    }

    package func save(pricedCardID: String) async -> Result<Void, WishlistError> {
        guard let context = readContextAfterAccountSync() else { return .failure(.unauthorized) }
        let result = await client.save(.init(pricedCardID: pricedCardID))
        guard readContextAfterAccountSync()?.session == context.session else { return .failure(.unauthorized) }
        if case .success = result { invalidateSnapshots(removedPrinting: nil) }
        return result
    }

    package func remove(printingKey: String) async -> Result<Void, WishlistError> {
        guard let context = readContextAfterAccountSync() else { return .failure(.unauthorized) }
        let result = await client.remove(printingKey: printingKey)
        guard readContextAfterAccountSync()?.session == context.session else { return .failure(.unauthorized) }
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
