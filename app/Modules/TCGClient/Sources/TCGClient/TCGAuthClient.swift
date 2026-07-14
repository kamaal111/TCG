//
//  TCGAuthClient.swift
//  TCGClient
//
//  Created by Kamaal M Farah on 7/11/26.
//

import Foundation
import KamaalLogger
import OpenAPIRuntime

private let logger = KamaalLogger(from: TCGAuthClient.self)

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
            guard let storedCredentials = try tokenRefresher.credentials(forKey: credentialsKeychainKey) else {
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
            try tokenRefresher.store(updatedCredentials, forKey: credentialsKeychainKey)
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
        do {
            try tokenRefresher.delete(forKey: credentialsKeychainKey)
        } catch {
            logger.warning("Couldn't remove old saved sign-in details before signing in: \(error)")
        }

        logger.info("Starting sign in request.")

        let response: Operations.PostAppApiAuthSignInEmail.Output
        do {
            response = try await client.postAppApiAuthSignInEmail(
                body: .json(.init(email: payload.email, password: payload.password))
            )
        } catch {
            logRequestFailure(operation: "Sign in", error: error)
            return .failure(.unknown(status: 503, payload: nil, cause: error))
        }

        let payload: Operations.PostAppApiAuthSignInEmail.Output.Ok
        switch response {
        case .badRequest(let badRequestResponse):
            let body = try? badRequestResponse.body.json
            let validations = TCGClientValidationErrorParser.parseIssues(from: body)

            return .failure(.badRequest(validations: validations))
        case .unauthorized(let unauthorizedResponse):
            let body = try? unauthorizedResponse.body.json
            let code = AuthUnauthorizedCode(rawValue: body?.code ?? "")
            guard code == .invalidEmailOrPassword else {
                logger.warning("Sign in was authorized but the session could not be established afterward.")
                return .failure(.sessionUnavailable)
            }
            return .failure(.badRequest(validations: []))
        case .undocumented(let statusCode, let payload):
            logger.warning("Sign in received an unexpected response from the server (status \(statusCode)).")
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
            else {
                logger.error("The sign in response did not include valid session details to save.")
                return .failure(.credentialsUnavailable(cause: CredentialsStorageError.invalidResponseHeaders))
            }
        } catch {
            logger.error(label: "Couldn't save sign-in details after a successful sign in", error: error)
            return .failure(.credentialsUnavailable(cause: error))
        }

        logger.info("Sign in completed and the session details were saved.")
        return .success(())
    }

    public func signUp(with payload: SignUpPayload) async -> Result<Void, SignUpErrors> {
        logger.info("Starting account creation request.")

        let response: Operations.PostAppApiAuthSignUpEmail.Output
        do {
            response = try await client.postAppApiAuthSignUpEmail(
                body: .json(.init(email: payload.email, password: payload.password, name: payload.name))
            )
        } catch {
            logRequestFailure(operation: "Account creation", error: error)
            return .failure(.unknown(status: 503, payload: nil, cause: error))
        }

        let payload: Operations.PostAppApiAuthSignUpEmail.Output.Created
        switch response {
        case .badRequest(let badRequestResponse):
            let body = try? badRequestResponse.body.json
            let validations = TCGClientValidationErrorParser.parseIssues(from: body)

            return .failure(.badRequest(validations: validations))
        case .unauthorized:
            logger.warning("Account creation was authorized but the session could not be established afterward.")
            return .failure(.sessionUnavailable)
        case .conflict:
            return .failure(.conflict)
        case .undocumented(let statusCode, let payload):
            logger.warning("Account creation received an unexpected response from the server (status \(statusCode)).")
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
            else {
                logger.error("The account creation response did not include valid session details to save.")
                return .failure(.credentialsUnavailable(cause: CredentialsStorageError.invalidResponseHeaders))
            }
        } catch {
            logger.error(label: "Couldn't save sign-in details after creating the account", error: error)
            return .failure(.credentialsUnavailable(cause: error))
        }

        logger.info("Account creation completed and the session details were saved.")
        return .success(())
    }

    private func logRequestFailure(operation: String, error: Error) {
        guard let clientError = error as? ClientError else {
            logger.error("\(operation) request failed before receiving a server response.")
            return
        }

        guard let response = clientError.response else {
            logger.error("\(operation) request failed before receiving a server response.")
            return
        }

        logger.error("\(operation) response could not be decoded (status \(response.status.code)).")
    }
}

private enum AuthUnauthorizedCode: String {
    case invalidEmailOrPassword = "INVALID_EMAIL_OR_PASSWORD"
}

private enum CredentialsStorageError: Error {
    case invalidResponseHeaders
}
