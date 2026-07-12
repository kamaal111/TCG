//
//  TCGAuthClient.swift
//  TCGClient
//
//  Created by Kamaal M Farah on 7/11/26.
//

import Foundation

public protocol TCGAuthClient: Sendable {
    func refreshToken() async -> Result<Void, SessionErrors>
    func session() async -> Result<Session, SessionErrors>
    func signIn(with payload: SignInPayload) async -> Result<Void, SignInErrors>
    func signUp(with payload: SignUpPayload) async -> Result<Void, SignUpErrors>
}

public struct TCGAuthClientImpl: TCGAuthClient {
    let credentialsKeychainKey: String

    private let client: Client
    private let tokenRefresher: TokenRefresher

    init(client: Client, tokenRefresher: TokenRefresher, credentialsKeychainKey: String) {
        self.client = client
        self.credentialsKeychainKey = credentialsKeychainKey
        self.tokenRefresher = tokenRefresher
    }

    public func refreshToken() async -> Result<Void, SessionErrors> {
        await tokenRefresher.refreshToken()
    }

    public func session() async -> Result<Session, SessionErrors> {
        let credentials: Credentials
        do {
            guard let storedCredentials = try await tokenRefresher.credentials(forKey: credentialsKeychainKey) else {
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
            return await tokenRefresher.deleteCredentials(then: .unauthorized)
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
            try await tokenRefresher.store(updatedCredentials, forKey: credentialsKeychainKey)
        } catch {
            return await tokenRefresher.deleteCredentials(then: .unknown(status: 500, payload: nil, cause: error))
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
        try? await tokenRefresher.delete(forKey: credentialsKeychainKey)

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
                try await tokenRefresher.storeCredentials(
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
                try await tokenRefresher.storeCredentials(
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
}
