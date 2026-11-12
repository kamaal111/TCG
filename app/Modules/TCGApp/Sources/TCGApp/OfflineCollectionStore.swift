import Foundation
import ImageIO
import SQLite3
import TCGClient

struct OfflineCollectionSnapshot: Codable, Sendable {
    let owner: String
    let accountID: String
    var etag: String
    var entries: [OfflineCollectionEntry]
    var cards: [CardWithPrice]
    var collections: [CardBinderCollection]
    var unavailableImages: Set<String>
    var checkedAt: Date?

    var grantIdentity: String { "\(owner)|\(accountID)" }

    var imageURLs: [URL] { cards.compactMap { $0.price.price?.imageURL } }

    var imageKeys: Set<String> { Set(imageURLs.compactMap(OfflineCollectionStore.imageKey)) }

    var missingImageCount: Int {
        cards.count { card in
            guard let url = card.price.price?.imageURL, let key = OfflineCollectionStore.imageKey(url) else {
                return true
            }
            return unavailableImages.contains(key)
        }
    }
}

struct OfflineCollectionStore {
    enum Failure: Error {
        case database
        case unavailable
    }

    let root: URL
    private var database: URL { root.appending(path: "collection.sqlite") }
    private var images: URL { root.appending(path: "images", directoryHint: .isDirectory) }

    enum Slot: Int32 {
        case downloaded = 1
        case pending = 2
    }

    func read(_ slot: Slot) throws -> OfflineCollectionSnapshot? {
        guard FileManager.default.fileExists(atPath: database.path) else { return nil }
        return try withDatabase { db in
            let statement = try prepare("SELECT payload FROM snapshots WHERE slot = ?", db: db)
            defer { sqlite3_finalize(statement) }
            sqlite3_bind_int(statement, 1, slot.rawValue)
            switch sqlite3_step(statement) {
            case SQLITE_DONE:
                return nil
            case SQLITE_ROW:
                guard let bytes = sqlite3_column_blob(statement, 0) else { throw Failure.database }
                let data = Data(bytes: bytes, count: Int(sqlite3_column_bytes(statement, 0)))
                return try JSONDecoder().decode(OfflineCollectionSnapshot.self, from: data)
            default:
                throw Failure.database
            }
        }
    }

    func save(_ snapshot: OfflineCollectionSnapshot, in slot: Slot) throws {
        try withDatabase { db in
            let statement = try prepare("INSERT OR REPLACE INTO snapshots (slot, payload) VALUES (?, ?)", db: db)
            defer { sqlite3_finalize(statement) }
            sqlite3_bind_int(statement, 1, slot.rawValue)
            let data = try JSONEncoder().encode(snapshot)
            let copyBytes = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
            try data.withUnsafeBytes { bytes in
                guard sqlite3_bind_blob(statement, 2, bytes.baseAddress, Int32(bytes.count), copyBytes) == SQLITE_OK,
                    sqlite3_step(statement) == SQLITE_DONE
                else { throw Failure.database }
            }
        }
    }

    func clearPending() throws {
        try withDatabase { db in
            guard sqlite3_exec(db, "DELETE FROM snapshots WHERE slot = 2", nil, nil, nil) == SQLITE_OK else {
                throw Failure.database
            }
        }
    }

    func remove() throws {
        if FileManager.default.fileExists(atPath: root.path) {
            try FileManager.default.removeItem(at: root)
        }
    }

    func removeUnusedImages(keeping keys: Set<String>) throws {
        guard FileManager.default.fileExists(atPath: images.path) else { return }
        for url in try FileManager.default.contentsOfDirectory(at: images, includingPropertiesForKeys: nil) {
            if !keys.contains(url.lastPathComponent) { try FileManager.default.removeItem(at: url) }
        }
    }

    func imageFile(for key: String) -> URL { images.appending(path: key, directoryHint: .notDirectory) }

    func hasImage(_ key: String) -> Bool {
        FileManager.default.fileExists(atPath: imageFile(for: key).path)
    }

    func imagesToDownload(_ urls: [URL], excluding unavailable: Set<String>) -> [String: URL] {
        var missing: [String: URL] = [:]
        for url in urls {
            guard let key = Self.imageKey(url), !unavailable.contains(key), !hasImage(key) else { continue }
            missing[key] = url
        }
        return missing
    }

    func removeImage(_ key: String) throws {
        if hasImage(key) { try FileManager.default.removeItem(at: imageFile(for: key)) }
    }

    func saveImage(_ data: Data, key: String) throws {
        try FileManager.default.createDirectory(at: images, withIntermediateDirectories: true)
        #if os(iOS)
            try data.write(to: imageFile(for: key), options: [.atomic, .completeFileProtection])
        #else
            try data.write(to: imageFile(for: key), options: .atomic)
        #endif
    }

    nonisolated static func imageKey(_ url: URL) -> String? {
        let key = url.lastPathComponent
        guard key.utf8.count == 64, key.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }) else {
            return nil
        }
        return key
    }

    nonisolated static func fetchImage(_ url: URL, session: URLSession) async throws -> Data? {
        let (data, response) = try await session.data(from: url)
        guard let response = response as? HTTPURLResponse else { throw Failure.unavailable }
        if response.statusCode == 404 { return nil }
        guard response.statusCode == 200 else { throw Failure.unavailable }
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
            CGImageSourceCreateImageAtIndex(source, 0, nil) != nil
        else { return nil }
        return data
    }

    private func withDatabase<T>(_ action: (OpaquePointer) throws -> T) throws -> T {
        var directory = root
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var resources = URLResourceValues()
        resources.isExcludedFromBackup = true
        try directory.setResourceValues(resources)

        #if os(iOS)
            try FileManager.default.setAttributes(
                [.protectionKey: FileProtectionType.complete],
                ofItemAtPath: root.path
            )
        #endif

        var connection: OpaquePointer?
        let opened = sqlite3_open(database.path, &connection)
        defer { sqlite3_close(connection) }
        guard opened == SQLITE_OK, let connection,
            sqlite3_exec(
                connection,
                """
                PRAGMA secure_delete = ON;
                CREATE TABLE IF NOT EXISTS snapshots (slot INTEGER PRIMARY KEY, payload BLOB NOT NULL);
                """,
                nil,
                nil,
                nil
            ) == SQLITE_OK
        else { throw Failure.database }
        return try action(connection)
    }

    private func prepare(_ sql: String, db: OpaquePointer) throws -> OpaquePointer {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK, let statement else {
            throw Failure.database
        }
        return statement
    }
}
