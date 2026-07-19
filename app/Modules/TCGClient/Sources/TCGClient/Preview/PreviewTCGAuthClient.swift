//
//  PreviewTCGAuthClient.swift
//  TCGClient
//
//  Created by Kamaal M Farah on 7/19/26.
//

import Foundation

/// A ``TCGAuthClient`` for SwiftUI previews that returns fixed, deterministic responses without any network I/O.
struct PreviewTCGAuthClient: TCGAuthClient {
    private let credentialsStore: CredentialsStore
    private let credentialsKeychainKey: String
    private let outcome: PreviewTCGAuthOutcome

    init(
        credentialsStore: CredentialsStore,
        credentialsKeychainKey: String,
        outcome: PreviewTCGAuthOutcome = .success
    ) {
        self.credentialsStore = credentialsStore
        self.credentialsKeychainKey = credentialsKeychainKey
        self.outcome = outcome
    }

    func refreshToken() async -> Result<Void, SessionErrors> {
        .success(())
    }

    func session() async -> Result<Session, SessionErrors> {
        let storedExpiry = (try? credentialsStore.credentials(forKey: credentialsKeychainKey))??.expiryDate

        return .success(
            Session(
                name: Self.name,
                email: Self.email,
                expiresAt: storedExpiry ?? Self.fallbackExpiresAt
            )
        )
    }

    func signIn(with _: SignInPayload) async -> Result<Void, SignInErrors> {
        switch outcome {
        case .success:
            .success(())
        case .invalidCredentials:
            .failure(.badRequest(validations: []))
        case .validationErrors(let issues):
            .failure(.badRequest(validations: issues))
        case .sessionUnavailable:
            .failure(.sessionUnavailable)
        case .serverUnavailable, .emailAlreadyInUse:
            .failure(.unknown(status: 500, payload: nil, cause: nil))
        }
    }

    func signUp(with _: SignUpPayload) async -> Result<Void, SignUpErrors> {
        switch outcome {
        case .success:
            .success(())
        case .validationErrors(let issues):
            .failure(.badRequest(validations: issues))
        case .sessionUnavailable:
            .failure(.sessionUnavailable)
        case .emailAlreadyInUse:
            .failure(.conflict)
        case .invalidCredentials, .serverUnavailable:
            .failure(.unknown(status: 500, payload: nil, cause: nil))
        }
    }

    private static let name = "Jane Doe"
    private static let email = "jane@example.com"
    private static let fallbackExpiresAt = Date.distantFuture
}
