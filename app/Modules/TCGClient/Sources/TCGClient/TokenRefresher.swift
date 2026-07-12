//
//  TokenRefresher.swift
//  TCGClient
//
//  Created by Kamaal M Farah on 7/12/26.
//

import Foundation
import KamaalLogger

private let logger = KamaalLogger(from: TokenRefresher.self, failOnError: true)

struct TokenRefresher: Sendable {
    private let client: Client
    private let credentialsKeychainKey: String
    private let credentialsStore: any CredentialsStore
    private let jsonEncoder = JSONEncoder()

    init(client: Client, credentialsKeychainKey: String, credentialsStore: any CredentialsStore) {
        self.client = client
        self.credentialsKeychainKey = credentialsKeychainKey
        self.credentialsStore = credentialsStore
    }

    func refreshToken() async -> Result<Void, SessionErrors> {
        let response: Operations.GetAppApiAuthToken.Output
        do {
            response = try await client.getAppApiAuthToken()
        } catch {
            return .failure(.unknown(status: 503, payload: nil, cause: error))
        }

        let payload: Operations.GetAppApiAuthToken.Output.Ok
        switch response {
        case .unauthorized:
            return await deleteCredentials(then: .unauthorized)
        case .undocumented(let statusCode, let payload):
            return .failure(.unknown(status: statusCode, payload: payload, cause: nil))
        case .ok(let ok):
            payload = ok
        }

        do {
            guard
                try await storeCredentials(
                    token: payload.headers.setAuthToken,
                    expiryTime: payload.headers.setAuthTokenExpiry,
                    sessionToken: payload.headers.setSessionToken,
                    sessionUpdateAge: payload.headers.setSessionUpdateAge,
                )
            else { return .failure(.unknown(status: 500, payload: nil, cause: nil)) }
        } catch {
            return .failure(.unknown(status: 500, payload: nil, cause: error))
        }

        return .success(())
    }

    func storeCredentials(
        token: String,
        expiryTime: String,
        sessionToken: String,
        sessionUpdateAge: String
    ) async throws -> Bool {
        guard let tokenExpiryTime = Int(expiryTime) else { return false }
        guard let tokenUpdateAge = Int(sessionUpdateAge) else { return false }

        let expiryTime = Date.now.timeIntervalSince1970 + TimeInterval(tokenExpiryTime)
        let expiryDate = Date(timeIntervalSince1970: expiryTime)
        let sessionUpdateAge = TimeInterval(tokenUpdateAge)

        logger.info("Storing JWT: \(String(token.prefix(7)))...")
        logger.info("Session token: \(String(sessionToken.prefix(7)))... (length: \(sessionToken.count))")

        let credentials = Credentials(
            authToken: token,
            expiryDate: expiryDate,
            sessionToken: sessionToken,
            sessionUpdateAge: sessionUpdateAge,
            lastSessionUpdate: .now,
        )
        let credentialsData = try jsonEncoder.encode(credentials)
        try credentialsStore.set(credentialsData, forKey: credentialsKeychainKey)

        return true
    }

    func credentials(forKey key: String) throws -> Credentials? {
        try credentialsStore.credentials(forKey: key)
    }

    func store(_ credentials: Credentials, forKey key: String) throws {
        let credentialsData = try jsonEncoder.encode(credentials)
        try credentialsStore.set(credentialsData, forKey: key)
    }

    func delete(forKey key: String) throws {
        try credentialsStore.delete(forKey: key)
    }

    func deleteCredentials<Success>(then result: SessionErrors) async -> Result<Success, SessionErrors> {
        do {
            try credentialsStore.delete(forKey: credentialsKeychainKey)
        } catch {
            return .failure(.unknown(status: 500, payload: nil, cause: error))
        }

        return .failure(result)
    }
}
