//
//  CredentialsStore.swift
//  TCGClient
//
//  Created by Kamaal M Farah on 7/12/26.
//

import Foundation
import TCGUtils

protocol CredentialsStore: Sendable {
    func set(_ data: Data, forKey key: String) async throws
}

struct KeychainCredentialsStore: CredentialsStore {
    func set(_ data: Data, forKey key: String) async throws {
        try Keychain.set(data, forKey: key).get()
    }
}
