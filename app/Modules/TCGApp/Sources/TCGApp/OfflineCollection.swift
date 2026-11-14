import Foundation
import Observation
import TCGClient

@MainActor
@Observable
final class OfflineCollection {
    enum Policy: String, CaseIterable {
        case wifi, anyConnection, manual
    }

    private enum Failure: Error {
        case incomplete
    }

    private let store: OfflineCollectionStore
    private let grant: any OfflineCollectionAccess
    private let client: TCGOfflineCollectionClient?
    private let namespace: String
    private let session: URLSession
    private let defaults: UserDefaults
    private var owner: String?
    private var generation = UUID()
    private var operation: Task<Void, Never>?
    private var unlockAttempt: UUID?
    private var lastAutomaticAttempt: Date?

    private(set) var hasDownload = false
    private(set) var hasPendingDownload = false
    private(set) var lastSync: Date?
    private(set) var missingImages = 0
    private(set) var progress: Double?
    private(set) var failed = false
    private(set) var unlockFailed = false
    private(set) var requiresDeviceSecurity = false
    var isUnlocking: Bool { unlockAttempt != nil }
    private(set) var opened: OfflineCollectionSnapshot?

    var policy: Policy {
        didSet { defaults.set(policy.rawValue, forKey: "offlineCollectionPolicy") }
    }

    init(
        client: TCGClient,
        defaults: UserDefaults,
        store: OfflineCollectionStore = .init(
            root: URL.applicationSupportDirectory.appending(path: "OfflineCollection")
        ),
        grant: any OfflineCollectionAccess = OfflineCollectionGrant(namespace: "local")
    ) {
        self.client = client.offlineCollection
        self.defaults = defaults
        self.store = store
        self.grant = grant
        namespace = TCGClient.authenticationStorageNamespace
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 30
        session = URLSession(configuration: configuration)
        policy = defaults.string(forKey: "offlineCollectionPolicy").flatMap(Policy.init(rawValue:)) ?? .wifi
        restore()
    }

    func setAccount(_ account: String) {
        let identity = "\(namespace)|\(account)"
        if let existing = owner, existing != identity { remove() }
        owner = identity
    }

    func automaticSync(wifi: Bool) {
        guard hasDownload || hasPendingDownload, policy != .manual, policy == .anyConnection || wifi,
            operation == nil, owner != nil
        else { return }
        let now = Date.now
        if let lastAutomaticAttempt, now.timeIntervalSince(lastAutomaticAttempt) < 900 { return }
        lastAutomaticAttempt = now
        sync()
    }

    func sync() {
        guard operation == nil, let owner, let client,
            !defaults.bool(forKey: "offlineCollectionRemovalPending")
        else { return }
        failed = false
        requiresDeviceSecurity = !grant.isAvailable
        guard !requiresDeviceSecurity else { return }
        progress = 0
        let token = generation
        operation = Task {
            defer {
                if token == generation {
                    progress = nil
                    operation = nil
                }
            }
            do {
                try await synchronizeWithRetry(client: client, owner: owner, token: token)
            } catch OfflineCollectionError.unauthorized {
                if token == generation { remove() }
            } catch {
                if token == generation {
                    hasPendingDownload = (try? store.read(.pending)) != nil
                    failed = true
                }
            }
        }
    }

    func open(reason: String) async {
        guard hasDownload, unlockAttempt == nil else { return }
        let attempt = UUID()
        unlockAttempt = attempt
        unlockFailed = false
        defer {
            if unlockAttempt == attempt { unlockAttempt = nil }
        }

        do {
            let download = try await unlockDownload(reason: reason, attempt: attempt)
            guard unlockAttempt == attempt, !Task.isCancelled else { return }
            opened = download
        } catch {
            if unlockAttempt == attempt, !Task.isCancelled { unlockFailed = true }
        }
    }

    private func unlockDownload(reason: String, attempt: UUID) async throws -> OfflineCollectionSnapshot {
        let verifiedOwner = try await grant.unlock(reason: reason)
        guard unlockAttempt == attempt, !Task.isCancelled else { throw CancellationError() }
        guard let download = try store.read(.downloaded),
            download.grantIdentity == verifiedOwner,
            download.owner == owner
        else { throw Failure.incomplete }
        return download
    }

    func close() {
        unlockAttempt = nil
        unlockFailed = false
        opened = nil
    }

    func removeDownload() {
        let activeOwner = owner
        remove()
        owner = activeOwner
    }

    func remove() {
        generation = UUID()
        operation?.cancel()
        operation = nil
        progress = nil
        close()
        requiresDeviceSecurity = false
        owner = nil
        hasDownload = false
        hasPendingDownload = false
        lastSync = nil
        missingImages = 0
        lastAutomaticAttempt = nil
        defaults.removeObject(forKey: "offlineCollectionLastCheck")
        defaults.set(true, forKey: "offlineCollectionRemovalPending")
        let grantRemoval = Result { try grant.remove() }
        let fileRemoval = Result { try store.remove() }
        failed = (try? grantRemoval.get()) == nil || (try? fileRemoval.get()) == nil
        if !failed { defaults.removeObject(forKey: "offlineCollectionRemovalPending") }
    }

    func imageFile(for url: URL) -> URL? {
        guard opened != nil, let key = OfflineCollectionStore.imageKey(url) else { return nil }
        return store.imageFile(for: key)
    }

    func invalidateImage(at file: URL) {
        guard opened != nil, store.imageFile(for: file.lastPathComponent) == file else { return }
        try? store.removeImage(file.lastPathComponent)
    }

    private func restore() {
        if defaults.bool(forKey: "offlineCollectionRemovalPending") {
            remove()
            return
        }
        do {
            try restoreDownload()
        } catch {
            failed = true
        }
    }

    private func restoreDownload() throws {
        let download = try store.read(.downloaded)
        let pending = try store.read(.pending)
        guard let knownOwner = download?.owner ?? pending?.owner else { return }
        guard knownOwner.hasPrefix("\(namespace)|") else {
            remove()
            return
        }
        owner = knownOwner
        if let download { updateStatus(download) }
        if let download, pending?.etag == download.etag, pending?.grantIdentity == download.grantIdentity {
            try store.clearPending()
            try store.removeUnusedImages(keeping: download.imageKeys)
        } else {
            hasPendingDownload = pending != nil
            let keys = (download?.imageKeys ?? []).union(pending?.imageKeys ?? [])
            try store.removeUnusedImages(keeping: keys)
        }
    }

    private func synchronizeWithRetry(client: TCGOfflineCollectionClient, owner: String, token: UUID) async throws {
        do {
            try await synchronize(client: client, owner: owner, token: token)
        } catch OfflineCollectionError.changed {
            try await synchronize(client: client, owner: owner, token: token)
        }
    }

    private func synchronize(client: TCGOfflineCollectionClient, owner: String, token: UUID) async throws {
        let downloaded = try store.read(.downloaded)
        let pending = try store.read(.pending)
        let shouldPrepare = downloaded?.cards.contains { $0.price.status == .unavailable } == true
        let etag = pending == nil && !shouldPrepare ? downloaded?.etag : nil
        let manifest = try await client.manifest(etag: etag)
        try check(token)
        if manifest == nil, let downloaded {
            try await refreshImages(for: downloaded, token: token)
            return
        }
        guard var current = manifest else { throw Failure.incomplete }
        if let existing = downloaded ?? pending, existing.accountID != current.accountID {
            removeDownload()
            return
        }
        if !current.needsPreparation.isEmpty {
            for offset in stride(from: 0, to: current.needsPreparation.count, by: 100) {
                let batch = Array(current.needsPreparation[offset..<min(offset + 100, current.needsPreparation.count)])
                do {
                    _ = try await client.prepare(batch)
                } catch OfflineCollectionError.unauthorized {
                    throw OfflineCollectionError.unauthorized
                } catch {
                    try check(token)
                    break
                }
                try check(token)
            }
            let refreshed = try await client.manifest(etag: nil)
            try check(token)
            guard let refreshed, refreshed.accountID == current.accountID else {
                throw OfflineCollectionError.changed
            }
            current = refreshed
        }

        let startingPoint = pending?.etag == current.etag ? pending : downloaded
        var next = try await downloadRecords(client: client, manifest: current, previous: startingPoint, owner: owner)
        try check(token)
        try store.save(next, in: .pending)
        hasPendingDownload = true
        if try await client.manifest(etag: current.etag) != nil { throw OfflineCollectionError.changed }
        try check(token)
        try grant.create(owner: next.grantIdentity)
        next.checkedAt = .now
        try store.save(next, in: .downloaded)
        unlockAttempt = nil
        updateStatus(next)
        if opened != nil { opened = next }
        try store.clearPending()
        hasPendingDownload = false
        try store.removeUnusedImages(keeping: next.imageKeys)
        try await refreshImages(for: next, token: token)
    }

    private func refreshImages(for download: OfflineCollectionSnapshot, token: UUID) async throws {
        var updated = download
        let missing = store.imagesToDownload(download.imageURLs, excluding: download.unavailableImages)
        if !missing.isEmpty {
            updated.unavailableImages.formUnion(try await downloadImages(missing, token: token))
            try check(token)
            try store.save(updated, in: .downloaded)
            updateStatus(updated)
        }
        lastSync = .now
        defaults.set(lastSync, forKey: "offlineCollectionLastCheck")
    }

    private func downloadRecords(
        client: TCGOfflineCollectionClient,
        manifest: OfflineCollectionManifest,
        previous: OfflineCollectionSnapshot?,
        owner: String
    ) async throws -> OfflineCollectionSnapshot {
        let previousEntries = Set(previous?.entries ?? [])
        let retained = Set(manifest.entries.filter(previousEntries.contains))
        let cardIDs = Set(retained.filter { $0.kind == .card }.map(\.id))
        let collectionIDs = Set(retained.filter { $0.kind == .collection }.map(\.id))
        var cards = previous?.cards.filter { cardIDs.contains($0.card.id) } ?? []
        var collections = previous?.collections.filter { collectionIDs.contains($0.id) } ?? []
        let changes = manifest.entries.filter { !retained.contains($0) }
        for offset in stride(from: 0, to: changes.count, by: 100) {
            try Task.checkCancellation()
            let batch = Array(changes[offset..<min(offset + 100, changes.count)])
            let records = try await client.records(batch)
            let expectedCards = Set(batch.filter { $0.kind == .card }.map(\.id))
            let expectedCollections = Set(batch.filter { $0.kind == .collection }.map(\.id))
            guard records.cards.count == expectedCards.count,
                Set(records.cards.map(\.card.id)) == expectedCards,
                records.collections.count == expectedCollections.count,
                Set(records.collections.map(\.id)) == expectedCollections
            else { throw Failure.incomplete }
            cards.append(contentsOf: records.cards)
            collections.append(contentsOf: records.collections)
        }
        guard cards.count + collections.count == manifest.entries.count else { throw Failure.incomplete }
        return OfflineCollectionSnapshot(
            owner: owner,
            accountID: manifest.accountID,
            etag: manifest.etag,
            entries: manifest.entries,
            cards: cards.sorted {
                ($0.card.createdAt, $0.card.id.uuidString) > ($1.card.createdAt, $1.card.id.uuidString)
            },
            collections: collections.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending },
            unavailableImages: [],
            checkedAt: nil
        )
    }

    private enum ArtworkDownload: Sendable {
        case downloaded(Data)
        case unavailable
        case retry
    }

    private func downloadImages(_ downloads: [String: URL], token: UUID) async throws -> Set<String> {
        let missing = Array(downloads)
        var unavailable: Set<String> = []
        for offset in stride(from: 0, to: missing.count, by: 2) {
            try check(token)
            try await withThrowingTaskGroup(of: (String, ArtworkDownload).self) { group in
                for (key, url) in missing[offset..<min(offset + 2, missing.count)] {
                    group.addTask { [session] in
                        do {
                            if let data = try await OfflineCollectionStore.fetchImage(url, session: session) {
                                return (key, .downloaded(data))
                            }
                            return (key, .unavailable)
                        } catch {
                            try Task.checkCancellation()
                            return (key, .retry)
                        }
                    }
                }
                for try await (key, result) in group {
                    try check(token)
                    switch result {
                    case .downloaded(let data): try? store.saveImage(data, key: key)
                    case .unavailable: unavailable.insert(key)
                    case .retry: break
                    }
                }
            }
            progress = Double(min(offset + 2, missing.count)) / Double(missing.count)
        }
        return unavailable
    }

    private func check(_ token: UUID) throws {
        try Task.checkCancellation()
        guard token == generation else { throw CancellationError() }
    }

    private func updateStatus(_ download: OfflineCollectionSnapshot) {
        hasDownload = true
        lastSync = [download.checkedAt, defaults.object(forKey: "offlineCollectionLastCheck") as? Date]
            .compactMap { $0 }
            .max()
        missingImages = store.missingImageCount(for: download)
    }
}
