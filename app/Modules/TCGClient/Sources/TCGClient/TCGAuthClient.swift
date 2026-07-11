//
//  TCGAuthClient.swift
//  TCGClient
//
//  Created by Kamaal M Farah on 7/11/26.
//

import Foundation
import KamaalLogger

private let logger = KamaalLogger(from: TCGAuthClient.self, failOnError: true)

public protocol TCGAuthClient: Sendable {
    func signUp(with payload: SignUpPayload) async -> Result<Void, SignUpErrors>
}

public struct TCGAuthClientImpl: TCGAuthClient {
    let credentialsKeychainKey: String

    private let client: Client
    private let credentialsStore: any CredentialsStore
    private let jsonEncoder = JSONEncoder()

    init(client: Client, credentialsKeychainKey: String, credentialsStore: any CredentialsStore) {
        self.client = client
        self.credentialsKeychainKey = credentialsKeychainKey
        self.credentialsStore = credentialsStore
    }

    public func signUp(with payload: SignUpPayload) async -> Result<Void, SignUpErrors> {
        let response: Operations.PostAppApiAuthSignUpEmail.Output
        do {
            response = try await client.postAppApiAuthSignUpEmail(
                body: .json(.init(email: payload.email, password: payload.password, name: payload.name))
            )
        } catch {
            return .failure(.unknown(status: 503, payload: nil, cause: error))
        }

        let payload: Operations.PostAppApiAuthSignUpEmail.Output.Created
        switch response {
        case .badRequest(let badRequestResponse):
            let body = try? badRequestResponse.body.json
            let validations = TCGClientValidationErrorParser.parseIssues(from: body)

            return .failure(.badRequest(validations: validations))
        case .unauthorized:
            return .failure(.badRequest(validations: []))
        case .conflict:
            return .failure(.conflict)
        case .undocumented(let statusCode, let payload):
            return .failure(.unknown(status: statusCode, payload: payload, cause: nil))
        case .created(let created):
            payload = created
        }

        guard let tokenExpiryTime = Int(payload.headers.setAuthTokenExpiry) else {
            return .failure(.unknown(status: 500, payload: nil, cause: nil))
        }
        guard let tokenUpdateAge = Int(payload.headers.setSessionUpdateAge) else {
            return .failure(.unknown(status: 500, payload: nil, cause: nil))
        }

        do {
            try await storeCredentials(
                token: payload.headers.setAuthToken,
                expiryTime: tokenExpiryTime,
                sessionToken: payload.headers.setSessionToken,
                sessionUpdateAge: tokenUpdateAge,
            )
        } catch {
            return .failure(.unknown(status: 500, payload: nil, cause: error))
        }

        return .success(())
    }

    private func storeCredentials(
        token: String,
        expiryTime: Int,
        sessionToken: String,
        sessionUpdateAge: Int
    ) async throws {
        let expiryTime = Date.now.timeIntervalSince1970 + TimeInterval(expiryTime)
        let expiryDate = Date(timeIntervalSince1970: expiryTime)
        let sessionUpdateAge = TimeInterval(sessionUpdateAge)

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
        try await credentialsStore.set(credentialsData, forKey: credentialsKeychainKey)
    }
}
