//
//  InMemoryCredentialsStore.swift
//  TCGClient
//
//  Created by Kamaal M Farah on 7/19/26.
//

import Foundation
import os

/// An in-memory ``CredentialsStore`` double for previews.
///
/// It behaves like the real Keychain-backed store but keeps everything in memory, so previews never touch the
/// Keychain. Seed it to make a preview look signed in.
final class InMemoryCredentialsStore: CredentialsStore {
    private let storage: OSAllocatedUnfairLock<Data?>

    init(seed: Data? = nil) {
        self.storage = OSAllocatedUnfairLock(initialState: seed)
    }

    func delete(forKey _: String) throws {
        storage.withLock { $0 = nil }
    }

    func get(forKey _: String) throws -> Data? {
        storage.withLock { $0 }
    }

    func set(_ data: Data, forKey _: String) throws {
        storage.withLock { $0 = data }
    }
}
