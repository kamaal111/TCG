//
//  KeychainTests.swift
//  TCGUtils
//
//  Created by Kamaal M Farah on 7/12/26.
//

import Foundation
import Security
import Testing

@testable import TCGUtils

@Suite("Keychain Tests")
struct KeychainTests {
    @Test
    func `Should retrieve stored data for a key`() throws {
        let keychain = KeychainAccessSpy()
        let key = "keychain-tests-\(UUID().uuidString)"
        let data = try #require("secret".data(using: .utf8))

        try Keychain.set(data, forKey: key, access: keychain.access).get()

        let retrieved = try Keychain.get(forKey: key, access: keychain.access).get()
        #expect(retrieved == data)
    }

    @Test
    func `Should overwrite existing data when setting the same key again`() throws {
        let keychain = KeychainAccessSpy()
        let key = "keychain-tests-\(UUID().uuidString)"
        let initialData = try #require("first".data(using: .utf8))
        let updatedData = try #require("second".data(using: .utf8))
        try Keychain.set(initialData, forKey: key, access: keychain.access).get()

        try Keychain.set(updatedData, forKey: key, access: keychain.access).get()

        let retrieved = try Keychain.get(forKey: key, access: keychain.access).get()
        #expect(retrieved == updatedData)
    }

    @Test
    func `Should return nil when getting a key that was never set`() throws {
        let keychain = KeychainAccessSpy()
        let key = "keychain-tests-\(UUID().uuidString)"

        let retrieved = try Keychain.get(forKey: key, access: keychain.access).get()

        #expect(retrieved == nil)
    }

    @Test
    func `Should return nil after deleting a stored key`() throws {
        let keychain = KeychainAccessSpy()
        let key = "keychain-tests-\(UUID().uuidString)"
        let data = try #require("to-delete".data(using: .utf8))
        try Keychain.set(data, forKey: key, access: keychain.access).get()

        try Keychain.delete(forKey: key, access: keychain.access).get()

        let retrieved = try Keychain.get(forKey: key, access: keychain.access).get()
        #expect(retrieved == nil)
    }

    @Test
    func `Should fail when deleting a key that does not exist`() {
        let keychain = KeychainAccessSpy()
        let key = "keychain-tests-\(UUID().uuidString)"

        #expect(throws: KeychainDeleteErrors.self) {
            try Keychain.delete(forKey: key, access: keychain.access).get()
        }
    }
}

private final class KeychainAccessSpy {
    private var values: [String: Data] = [:]

    var access: KeychainAccess {
        KeychainAccess(
            add: { [unowned self] query, _ in add(query) },
            copyMatching: { [unowned self] query, result in copyMatching(query, result: result) },
            delete: { [unowned self] query in delete(query) },
            update: { [unowned self] query, attributes in update(query, attributes: attributes) }
        )
    }

    private func add(_ query: CFDictionary) -> OSStatus {
        let key = key(from: query)
        guard values[key] == nil else { return errSecDuplicateItem }
        values[key] = data(from: query)

        return errSecSuccess
    }

    private func copyMatching(_ query: CFDictionary, result: UnsafeMutablePointer<AnyObject?>?) -> OSStatus {
        guard let data = values[key(from: query)] else { return errSecItemNotFound }
        result?.pointee = data as NSData

        return errSecSuccess
    }

    private func delete(_ query: CFDictionary) -> OSStatus {
        let key = key(from: query)
        guard values.removeValue(forKey: key) != nil else { return errSecItemNotFound }

        return errSecSuccess
    }

    private func update(_ query: CFDictionary, attributes: CFDictionary) -> OSStatus {
        let key = key(from: query)
        guard values[key] != nil else { return errSecItemNotFound }
        values[key] = data(from: attributes)

        return errSecSuccess
    }

    private func key(from query: CFDictionary) -> String {
        let dictionary = query as NSDictionary
        guard let key = dictionary[kSecAttrAccount] as? String else {
            preconditionFailure("Keychain query must contain an account key.")
        }

        return key
    }

    private func data(from query: CFDictionary) -> Data {
        let dictionary = query as NSDictionary
        guard let data = dictionary[kSecValueData] as? Data else {
            preconditionFailure("Keychain query must contain data.")
        }

        return data
    }
}
