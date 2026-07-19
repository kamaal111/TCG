//
//  PreviewTCGAuthClient.swift
//  TCGClient
//
//  Created by Kamaal M Farah on 7/19/26.
//

import Foundation

/// A ``TCGAuthClient`` for SwiftUI previews that returns fixed, deterministic responses without any network I/O.
public struct PreviewTCGAuthClient: TCGAuthClient {
    private let credentialsStore: CredentialsStore
    private let credentialsKeychainKey: String

    init(credentialsStore: CredentialsStore, credentialsKeychainKey: String) {
        self.credentialsStore = credentialsStore
        self.credentialsKeychainKey = credentialsKeychainKey
    }

    public func refreshToken() async -> Result<Void, SessionErrors> {
        .success(())
    }

    public func session() async -> Result<Session, SessionErrors> {
        let storedExpiry = (try? credentialsStore.credentials(forKey: credentialsKeychainKey))??.expiryDate

        return .success(
            Session(
                name: Self.name,
                email: Self.email,
                expiresAt: storedExpiry ?? Self.fallbackExpiresAt
            )
        )
    }

    public func signIn(with _: SignInPayload) async -> Result<Void, SignInErrors> {
        .success(())
    }

    public func signUp(with _: SignUpPayload) async -> Result<Void, SignUpErrors> {
        .success(())
    }

    private static let name = "Jane Doe"
    private static let email = "jane@example.com"
    private static let fallbackExpiresAt = Date.distantFuture
}
