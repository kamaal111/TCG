//
//  TCGAuthTestDoubles.swift
//  TCGFeatures
//
//  Created by Codex on 7/16/26.
//

import Foundation
import TCGClient

@testable import TCGAuth

@MainActor
final class CachedUserSessionStoreSpy: CachedUserSessionStore {
    var cachedSession: CachedUserSession?

    init(cachedSession: CachedUserSession? = nil) {
        self.cachedSession = cachedSession
    }
}

final class CredentialsStoreSpy: CredentialsStore, @unchecked Sendable {
    private let lock = NSLock()
    private var storedData: Data?

    init(initialData: Data? = nil) {
        self.storedData = initialData
    }

    func delete(forKey _: String) throws {
        lock.lock()
        defer { lock.unlock() }

        storedData = nil
    }

    func get(forKey _: String) throws -> Data? {
        lock.lock()
        defer { lock.unlock() }

        return storedData
    }

    func set(_ data: Data, forKey _: String) throws {
        lock.lock()
        defer { lock.unlock() }

        storedData = data
    }
}
