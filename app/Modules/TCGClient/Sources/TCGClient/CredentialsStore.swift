//
//  CredentialsStore.swift
//  TCGClient
//
//  Created by Kamaal M Farah on 7/12/26.
//

import Foundation
import TCGUtils

public protocol CredentialsStore: Sendable {
    func delete(forKey key: String) throws
    func get(forKey key: String) throws -> Data?
    func set(_ data: Data, forKey key: String) throws
}

struct KeychainCredentialsStore: CredentialsStore {
    func delete(forKey key: String) throws {
        guard try get(forKey: key) != nil else { return }

        try Keychain.delete(forKey: key).get()
    }

    func get(forKey key: String) throws -> Data? {
        try Keychain.get(forKey: key).get()
    }

    func set(_ data: Data, forKey key: String) throws {
        try Keychain.set(data, forKey: key).get()
    }
}

extension CredentialsStore {
    func credentials(forKey key: String) throws -> Credentials? {
        guard let data = try get(forKey: key) else { return nil }

        return try JSONDecoder().decode(Credentials.self, from: data)
    }
}
