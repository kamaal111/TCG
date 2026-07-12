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
    func refreshToken() async -> Result<Void, SessionErrors>
    func session() async -> Result<Session, SessionErrors>
    func signIn(with payload: SignInPayload) async -> Result<Void, SignInErrors>
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

    public func refreshToken() async -> Result<Void, SessionErrors> {
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

    public func session() async -> Result<Session, SessionErrors> {
        let credentials: Credentials
        do {
            guard let storedCredentials = try await credentialsStore.credentials(forKey: credentialsKeychainKey) else {
                return .failure(.unauthorized)
            }

            credentials = storedCredentials
        } catch {
            return .failure(.unknown(status: 500, payload: nil, cause: error))
        }

        let response: Operations.GetAppApiAuthSession.Output
        do {
            response = try await client.getAppApiAuthSession()
        } catch {
            return .failure(.unknown(status: 503, payload: nil, cause: error))
        }

        let payload: Operations.GetAppApiAuthSession.Output.Ok
        switch response {
        case .notFound:
            return await deleteCredentials(then: .unauthorized)
        case .undocumented(let statusCode, let payload):
            return .failure(.unknown(status: statusCode, payload: payload, cause: nil))
        case .ok(let ok):
            payload = ok
        }

        let responsePayload: Components.Schemas.SessionResponse
        do {
            responsePayload = try payload.body.json
        } catch {
            return .failure(.unknown(status: 503, payload: nil, cause: error))
        }

        let updatedCredentials = credentials.setExpiryDate(responsePayload.session.expiresAt)
        do {
            let credentialsData = try jsonEncoder.encode(updatedCredentials)
            try await credentialsStore.set(credentialsData, forKey: credentialsKeychainKey)
        } catch {
            return await deleteCredentials(then: .unknown(status: 500, payload: nil, cause: error))
        }

        return .success(
            .init(
                name: responsePayload.user.name,
                email: responsePayload.user.email,
                expiresAt: responsePayload.session.expiresAt
            )
        )
    }

    public func signIn(with payload: SignInPayload) async -> Result<Void, SignInErrors> {
        try? await credentialsStore.delete(forKey: credentialsKeychainKey)

        let response: Operations.PostAppApiAuthSignInEmail.Output
        do {
            response = try await client.postAppApiAuthSignInEmail(
                body: .json(.init(email: payload.email, password: payload.password))
            )
        } catch {
            return .failure(.unknown(status: 503, payload: nil, cause: error))
        }

        let payload: Operations.PostAppApiAuthSignInEmail.Output.Ok
        switch response {
        case .badRequest(let badRequestResponse):
            let body = try? badRequestResponse.body.json
            let validations = TCGClientValidationErrorParser.parseIssues(from: body)

            return .failure(.badRequest(validations: validations))
        case .unauthorized:
            return .failure(.badRequest(validations: []))
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

    private func storeCredentials(
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
        try await credentialsStore.set(credentialsData, forKey: credentialsKeychainKey)

        return true
    }

    private func deleteCredentials<Success>(then result: SessionErrors) async -> Result<Success, SessionErrors> {
        do {
            try await credentialsStore.delete(forKey: credentialsKeychainKey)
        } catch {
            return .failure(.unknown(status: 500, payload: nil, cause: error))
        }

        return .failure(result)
    }
}
