import Foundation
import Testing

@testable import TCGApp

struct OfflineCollectionStoreTests {
    @Test func `Pending metadata never replaces the downloaded copy before publication`() throws {
        let store = makeStore()
        defer { try? store.remove() }
        try store.save(snapshot(etag: "first"), in: .downloaded)
        try store.save(snapshot(etag: "second"), in: .pending)

        let restored = OfflineCollectionStore(root: store.root)
        #expect(try restored.read(.downloaded)?.etag == "first")
        #expect(try restored.read(.pending)?.etag == "second")

        try restored.save(snapshot(etag: "second"), in: .downloaded)
        try restored.clearPending()
        #expect(try store.read(.downloaded)?.etag == "second")
        #expect(try store.read(.pending) == nil)
    }

    @Test func `Reuses one downloaded image for duplicate references and clears unreferenced files`() throws {
        let store = makeStore()
        defer { try? store.remove() }
        let key = String(repeating: "a", count: 64)
        let url = try #require(URL(string: "https://example.com/app-api/images/\(key)"))
        #expect(store.imagesToDownload([url, url], excluding: []) == [key: url])

        try store.saveImage(Data([1, 2, 3]), key: key)
        let restored = OfflineCollectionStore(root: store.root)
        #expect(restored.imagesToDownload([url, url], excluding: []).isEmpty)
        try restored.removeUnusedImages(keeping: [key])
        #expect(restored.hasImage(key))

        try restored.removeUnusedImages(keeping: [])
        #expect(!restored.hasImage(key))
        #expect(restored.imagesToDownload([url], excluding: []) == [key: url])
    }

    @Test func `Removing the download clears downloaded and pending state and images`() throws {
        let store = makeStore()
        defer { try? store.remove() }
        try store.save(snapshot(etag: "first"), in: .downloaded)
        try store.save(snapshot(etag: "second"), in: .pending)
        let key = String(repeating: "a", count: 64)
        try store.saveImage(Data([1, 2, 3]), key: key)

        try store.remove()

        #expect(try store.read(.downloaded) == nil)
        #expect(try store.read(.pending) == nil)
        #expect(!store.hasImage(key))
        #expect(!FileManager.default.fileExists(atPath: store.root.path))
    }

    private func makeStore() -> OfflineCollectionStore {
        OfflineCollectionStore(root: FileManager.default.temporaryDirectory.appending(path: UUID().uuidString))
    }

    private func snapshot(etag: String) -> OfflineCollectionSnapshot {
        OfflineCollectionSnapshot(
            owner: "server|owner",
            accountID: "owner-id",
            etag: etag,
            entries: [],
            cards: [],
            collections: [],
            unavailableImages: [],
            checkedAt: nil
        )
    }
}
