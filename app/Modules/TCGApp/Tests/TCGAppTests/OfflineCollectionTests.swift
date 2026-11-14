import Foundation
import TCGClient
import Testing

@testable import TCGApp

@MainActor
struct OfflineCollectionTests {
    @Test func `A restored download opens after device authentication`() async throws {
        let fixture = try makeFixture()
        defer { try? fixture.store.remove() }
        let attempt = Task { await fixture.download.open(reason: "Unlock") }
        let unlock = try #require(await fixture.grant.nextUnlock())
        unlock.resume(returning: fixture.identity)
        await attempt.value

        #expect(fixture.download.opened?.accountID == "owner-id")
        #expect(!fixture.download.isUnlocking)
    }

    @Test func `Closing during authentication discards a late unlock`() async throws {
        let fixture = try makeFixture()
        defer { try? fixture.store.remove() }
        let attempt = Task { await fixture.download.open(reason: "Unlock") }
        let unlock = try #require(await fixture.grant.nextUnlock())
        fixture.download.close()
        unlock.resume(returning: fixture.identity)
        await attempt.value

        #expect(fixture.download.opened == nil)
        #expect(!fixture.download.isUnlocking)
        #expect(fixture.download.hasDownload)
    }

    @Test func `Switching accounts invalidates a pending unlock and removes the old download`() async throws {
        let fixture = try makeFixture()
        defer { try? fixture.store.remove() }
        let attempt = Task { await fixture.download.open(reason: "Unlock") }
        let unlock = try #require(await fixture.grant.nextUnlock())
        fixture.download.setAccount("another@example.com")
        unlock.resume(returning: fixture.identity)
        await attempt.value

        #expect(fixture.download.opened == nil)
        #expect(!fixture.download.hasDownload)
        #expect(try fixture.store.read(.downloaded) == nil)
        #expect(fixture.grant.removed)
    }

    @Test func `Removing the download on sign-out closes the unlocked copy`() async throws {
        let fixture = try makeFixture()
        defer { try? fixture.store.remove() }
        let attempt = Task { await fixture.download.open(reason: "Unlock") }
        let unlock = try #require(await fixture.grant.nextUnlock())
        unlock.resume(returning: fixture.identity)
        await attempt.value

        fixture.download.remove()

        #expect(fixture.download.opened == nil)
        #expect(!fixture.download.hasDownload)
        #expect(try fixture.store.read(.downloaded) == nil)
        #expect(fixture.grant.removed)
    }

    private func makeFixture() throws -> (
        download: OfflineCollection, store: OfflineCollectionStore, grant: ControlledOfflineAccess, identity: String
    ) {
        let identifier = UUID().uuidString
        let store = OfflineCollectionStore(root: FileManager.default.temporaryDirectory.appending(path: identifier))
        let defaults = try #require(UserDefaults(suiteName: identifier))
        let snapshot = OfflineCollectionSnapshot(
            owner: "\(TCGClient.authenticationStorageNamespace)|owner@example.com",
            accountID: "owner-id",
            etag: "current",
            entries: [],
            cards: [],
            collections: [],
            unavailableImages: [],
            checkedAt: nil
        )
        try store.save(snapshot, in: .downloaded)
        let grant = ControlledOfflineAccess()
        let download = OfflineCollection(client: .default(), defaults: defaults, store: store, grant: grant)
        return (download, store, grant, snapshot.grantIdentity)
    }
}

@MainActor
private final class ControlledOfflineAccess: OfflineCollectionAccess {
    private let stream = AsyncStream<CheckedContinuation<String, any Error>>.makeStream()
    private(set) var removed = false
    let isAvailable = true

    func create(owner: String) throws {}

    func unlock(reason: String) async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            stream.continuation.yield(continuation)
        }
    }

    func remove() throws { removed = true }

    func nextUnlock() async -> CheckedContinuation<String, any Error>? {
        var iterator = stream.stream.makeAsyncIterator()
        return await iterator.next()
    }
}
