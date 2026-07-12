//
//  KeychainTests.swift
//  TCGUtils
//
//  Created by Kamaal M Farah on 7/12/26.
//

import Foundation
import Testing

@testable import TCGUtils

@Suite("Keychain Tests")
struct KeychainTests {
    @Test
    func `Should retrieve stored data for a key`() throws {
        let key = "keychain-tests-\(UUID().uuidString)"
        let data = try #require("secret".data(using: .utf8))
        defer { Keychain.delete(forKey: key) }

        try Keychain.set(data, forKey: key).get()

        let retrieved = try Keychain.get(forKey: key).get()
        #expect(retrieved == data)
    }

    @Test
    func `Should overwrite existing data when setting the same key again`() throws {
        let key = "keychain-tests-\(UUID().uuidString)"
        let initialData = try #require("first".data(using: .utf8))
        let updatedData = try #require("second".data(using: .utf8))
        defer { Keychain.delete(forKey: key) }
        try Keychain.set(initialData, forKey: key).get()

        try Keychain.set(updatedData, forKey: key).get()

        let retrieved = try Keychain.get(forKey: key).get()
        #expect(retrieved == updatedData)
    }

    @Test
    func `Should return nil when getting a key that was never set`() throws {
        let key = "keychain-tests-\(UUID().uuidString)"

        let retrieved = try Keychain.get(forKey: key).get()

        #expect(retrieved == nil)
    }

    @Test
    func `Should return nil after deleting a stored key`() throws {
        let key = "keychain-tests-\(UUID().uuidString)"
        let data = try #require("to-delete".data(using: .utf8))
        try Keychain.set(data, forKey: key).get()

        try Keychain.delete(forKey: key).get()

        let retrieved = try Keychain.get(forKey: key).get()
        #expect(retrieved == nil)
    }

    @Test
    func `Should fail when deleting a key that does not exist`() {
        let key = "keychain-tests-\(UUID().uuidString)"

        #expect(throws: KeychainDeleteErrors.self) {
            try Keychain.delete(forKey: key).get()
        }
    }
}
