import Foundation
import HTTPTypes
import KamaalAuth
import KamaalLogger
import LocalAuthentication
import OpenAPIRuntime
import TCGClient
import Testing

@testable import TCGApp

@MainActor
struct OfflineCollectionTests {
    @Test func `A fresh token opens the matching signed-in account without device authentication`() throws {
        let fixture = try makeFixture(hasFreshAuthToken: true)
        defer { try? fixture.store.remove() }
        fixture.download.setAccount("owner@example.com")

        fixture.download.openWithFreshToken()

        #expect(fixture.download.opened?.accountID == "owner-id")
        #expect(!fixture.download.isUnlocking)
    }

    @Test func `A fresh token without a matching signed-in account cannot bypass device authentication`() throws {
        let fixture = try makeFixture(hasFreshAuthToken: true)
        defer { try? fixture.store.remove() }

        fixture.download.openWithFreshToken()

        #expect(fixture.download.opened == nil)
    }

    @Test func `A token due for refresh leaves the collection locked until device authentication`() throws {
        let fixture = try makeFixture(hasFreshAuthToken: false)
        defer { try? fixture.store.remove() }
        fixture.download.setAccount("owner@example.com")

        fixture.download.openWithFreshToken()

        #expect(fixture.download.opened == nil)
        #expect(!fixture.download.isUnlocking)
    }

    @Test func `A restored download opens after device authentication`() async throws {
        let fixture = try makeFixture(hasFreshAuthToken: false)
        defer { try? fixture.store.remove() }
        let attempt = Task { await fixture.download.open(reason: "Unlock") }
        let unlock = try #require(await fixture.grant.nextUnlock())
        unlock.resume(returning: fixture.identity)
        await attempt.value

        #expect(fixture.download.opened?.accountID == "owner-id")
        #expect(!fixture.download.isUnlocking)
    }

    @Test func `Startup fallback requires the matching download and its device grant`() async throws {
        let fixture = try makeFixture(hasFreshAuthToken: true)
        defer { try? fixture.store.remove() }
        #expect(!fixture.download.hasStartupDownload(for: "other@example.com"))
        #expect(try await fixture.download.startupDownload(for: "other@example.com", using: LAContext()) == nil)

        let attempt = Task {
            try await fixture.download.startupDownload(for: "owner@example.com", using: LAContext())
        }
        let unlock = try #require(await fixture.grant.nextUnlock())
        unlock.resume(returning: fixture.identity)

        #expect(try await attempt.value?.accountID == "owner-id")
        #expect(fixture.download.opened == nil)
    }

    @Test func `Closing during authentication discards a late unlock`() async throws {
        let fixture = try makeFixture(hasFreshAuthToken: false)
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
        let fixture = try makeFixture(hasFreshAuthToken: false)
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
        let fixture = try makeFixture(hasFreshAuthToken: false)
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

    @Test func `A retried offline sync records one start and one completion`() async throws {
        let holder = LogHolder(max: 8)
        let transport = RetryingManifestTransport()
        let fixture = try makeSyncFixture(transport: transport, holder: holder)
        defer { try? fixture.store.remove() }

        fixture.download.sync()

        let expected = ["offline.sync.started", "offline.sync.completed"]
        await waitForSync(fixture.download)
        #expect(await holder.logs.map(\.message) == expected)
        #expect(await holder.logs.last?.fields().map(\.value.displayText) == ["0"])
        #expect(await transport.requestCount == 4)
        #expect(!fixture.download.hasPendingDownload)
        #expect(!fixture.download.failed)
    }

    @Test func `Downloads 101 changed records in ordered requests of 100 and 1`() async throws {
        let ids = (1...101).map { String(format: "00000000-0000-4000-8000-%012d", $0) }
        let transport = RecordBatchTransport(ids: ids)
        let holder = LogHolder(max: 8)
        let fixture = try makeSyncFixture(transport: transport, holder: holder)
        defer { try? fixture.store.remove() }

        fixture.download.sync()
        await waitForSync(fixture.download)

        #expect(await transport.batches == [Array(ids.prefix(100)), Array(ids.suffix(1))])
        let downloaded = try fixture.store.read(.downloaded)
        let saved = try #require(downloaded)
        #expect(saved.entries.map { $0.id.uuidString.lowercased() } == ids)
        #expect(saved.collections.count == 101)
        #expect(await holder.logs.last?.message == "offline.sync.completed")
    }

    private func waitForSync(_ download: OfflineCollection) async {
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: .seconds(2))
        while download.progress != nil, clock.now < deadline {
            await Task.yield()
        }
    }

    private func makeSyncFixture(transport: any ClientTransport, holder: LogHolder) throws -> (
        download: OfflineCollection, store: OfflineCollectionStore, grant: ControlledOfflineAccess, identity: String
    ) {
        let credentials = Credentials(
            authToken: "auth-token",
            authTokenExpiryDate: .distantFuture,
            sessionToken: "session-token",
            sessionUpdateAge: 1800,
            lastSessionUpdate: .now
        )
        let credentialsKey = "offline-sync-tests"
        let client = TCGClient.default(
            transport: transport,
            credentialsKeychainKey: credentialsKey,
            credentialsStore: InMemoryCredentialsStore(seed: try JSONEncoder().encode(credentials), key: credentialsKey)
        )
        return try makeFixture(
            hasFreshAuthToken: true,
            client: client,
            logger: KamaalLogger(from: OfflineCollection.self, holder: holder)
        )
    }

    private func makeFixture(hasFreshAuthToken: Bool) throws -> (
        download: OfflineCollection, store: OfflineCollectionStore, grant: ControlledOfflineAccess, identity: String
    ) {
        try makeFixture(
            hasFreshAuthToken: hasFreshAuthToken,
            client: .default(),
            logger: KamaalLogger(from: OfflineCollection.self)
        )
    }

    private func makeFixture(hasFreshAuthToken: Bool, client: TCGClient, logger: KamaalLogger) throws -> (
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
        let download = OfflineCollection(
            client: client,
            defaults: defaults,
            store: store,
            grant: grant,
            hasFreshAuthToken: { hasFreshAuthToken },
            logger: logger
        )
        return (download, store, grant, snapshot.grantIdentity)
    }
}

@MainActor
private final class ControlledOfflineAccess: OfflineCollectionAccess {
    private let stream = AsyncStream<CheckedContinuation<String, any Error>>.makeStream()
    private(set) var removed = false
    let isAvailable = true

    func create(owner: String) throws {}

    func unlock(using context: LAContext, reason: String?) async throws -> String {
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

private actor RetryingManifestTransport: ClientTransport {
    private(set) var requestCount = 0

    func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws -> (
        HTTPResponse, HTTPBody?
    ) {
        requestCount += 1
        let etag = "\"current\""
        guard requestCount <= 3 else {
            return (HTTPResponse(status: .notModified, headerFields: [.eTag: etag]), nil)
        }
        let response = HTTPResponse(status: .ok, headerFields: [.contentType: "application/json", .eTag: etag])
        let manifest = """
            {"version":1,"account_id":"owner-id","entries":[],"needs_preparation":[]}
            """
        return (response, HTTPBody(manifest))
    }
}

private actor RecordBatchTransport: ClientTransport {
    private struct RecordsRequest: Decodable {
        struct Entry: Decodable { let id: String }
        let entries: [Entry]
    }

    private let ids: [String]
    private(set) var batches: [[String]] = []
    private var sentManifest = false

    init(ids: [String]) {
        self.ids = ids
    }

    func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws -> (
        HTTPResponse, HTTPBody?
    ) {
        let etag = "\"updated\""
        let headers: HTTPFields = [.contentType: "application/json", .eTag: etag]
        switch request.path {
        case "/app-api/cards/offline/manifest":
            guard !sentManifest else { return (HTTPResponse(status: .notModified, headerFields: headers), nil) }
            sentManifest = true
            let hash = String(repeating: "a", count: 64)
            let entries =
                ids
                .map { id in
                    """
                    {"kind":"collection","id":"\(id)","hash":"\(hash)"}
                    """
                }
                .joined(separator: ",")
            let manifest = """
                {"version":1,"account_id":"owner-id","entries":[\(entries)],"needs_preparation":[]}
                """
            return (HTTPResponse(status: .ok, headerFields: headers), HTTPBody(manifest))
        case "/app-api/cards/offline/records":
            let data = try await Data(collecting: #require(body), upTo: 100_000)
            let request = try JSONDecoder().decode(RecordsRequest.self, from: data)
            let batch = request.entries.map(\.id)
            batches.append(batch)
            let collections =
                batch
                .map { id in
                    """
                    {"id":"\(id)","name":"\(id)","is_unfiled":false,"revision":0,"columns":1,"rows":1,"pages":[]}
                    """
                }
                .joined(separator: ",")
            let records = """
                {"cards":[],"collections":[\(collections)]}
                """
            return (HTTPResponse(status: .ok, headerFields: headers), HTTPBody(records))
        default:
            return (HTTPResponse(status: .notFound), nil)
        }
    }
}
