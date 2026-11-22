import CryptoKit
import Foundation

@MainActor
package final class AccountSnapshotStore<Snapshot: Codable> {
    private let root: URL
    private let namespace: String
    private var file: URL?

    package init(root: URL, namespace: String) {
        self.root = root
        self.namespace = namespace
    }

    package func open(account: String?) -> Snapshot? {
        file = nil
        guard let account, (try? prepareDirectory()) != nil else { return nil }

        let file = snapshotFile(for: account)
        self.file = file
        return Self.read(file)
    }

    package func containsSnapshot(for account: String) -> Bool {
        FileManager.default.fileExists(atPath: snapshotFile(for: account).path)
    }

    package func read(account: String) async -> Snapshot? where Snapshot: Sendable {
        let file = snapshotFile(for: account)
        return await Task.detached(priority: .userInitiated) { Self.read(file) }.value
    }

    private nonisolated static func read(_ file: URL) -> Snapshot? {
        guard let data = try? Data(contentsOf: file) else { return nil }
        return try? JSONDecoder().decode(Snapshot.self, from: data)
    }

    package func write(_ snapshot: Snapshot) {
        guard let file, let data = try? JSONEncoder().encode(snapshot) else { return }

        #if os(iOS)
            try? data.write(to: file, options: [.atomic, .completeFileProtection])
        #else
            try? data.write(to: file, options: .atomic)
        #endif
    }

    private func snapshotFile(for account: String) -> URL {
        let identity = "\(namespace)|\(account)"
        let key = SHA256.hash(data: Data(identity.utf8)).map { String(format: "%02x", $0) }.joined()
        return root.appending(path: "\(key).json")
    }

    private func prepareDirectory() throws {
        var directory = root
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var resources = URLResourceValues()
        resources.isExcludedFromBackup = true
        try directory.setResourceValues(resources)
    }
}
