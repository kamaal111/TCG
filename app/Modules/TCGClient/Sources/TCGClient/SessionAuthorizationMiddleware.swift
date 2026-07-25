//
//  SessionAuthorizationMiddleware.swift
//  TCGClient
//
//  Created by Kamaal M Farah on 7/12/26.
//

import Foundation
import HTTPTypes
import KamaalLogger
import OpenAPIRuntime

private let logger = KamaalLogger(from: SessionAuthorizationMiddleware.self)

struct SessionAuthorizationMiddleware: ClientMiddleware {
    let credentialsKeychainKey: String
    let credentialsStore: CredentialsStore
    let tokenRefresher: TokenRefresher

    func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @concurrent @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        let credentials = try credentialsStore.credentials(forKey: credentialsKeychainKey)
        guard let credentials else { return try await next(request, body, baseURL) }

        guard !credentials.sessionHasExpired else {
            try credentialsStore.delete(forKey: credentialsKeychainKey)
            logger.warning("Deleted authentication credentials; reason=session_expired")

            return try await next(request, body, baseURL)
        }

        let refreshedToken = try await refreshIfNeeded(credentials, operationID: operationID)

        return try await authenticatedRequest(
            from: refreshedToken,
            request: request,
            body: body,
            baseURL: baseURL,
            operationID: operationID,
            next: next
        )
    }

    private func refreshIfNeeded(_ credentials: Credentials, operationID: String) async throws -> Credentials {
        guard credentials.shouldUpdateSession || credentials.authTokenWillExpireSoon() else { return credentials }

        let reason = credentials.shouldUpdateSession ? "session_update_age" : "auth_token_expiring"
        let authTokenAge = Int(Date.now.timeIntervalSince(credentials.lastSessionUpdate))
        let authTokenRemaining = Int(credentials.authTokenExpiryDate.timeIntervalSinceNow)
        logger.info(
            "Refreshing the authentication token; reason=\(reason); credential=session_token; auth_token_age_s=\(authTokenAge); auth_token_remaining_s=\(authTokenRemaining)"
        )

        do {
            try await tokenRefresher.refreshToken().get()
        } catch {
            logger.warning("Authentication token refresh failed; operationID=\(operationID); error=\(error)")
            throw error
        }

        let refreshedCredentials = try credentialsStore.credentials(forKey: credentialsKeychainKey)
        guard let refreshedCredentials else { throw SessionErrors.unauthorized }

        return refreshedCredentials
    }

    private func authenticatedRequest(
        from credentials: Credentials,
        request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @concurrent @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        var authenticatedRequest = request
        authenticatedRequest.headerFields[.authorization] = "Bearer \(credentials.authToken)"
        logger.info("Attached authentication credential; credential=jwt; operationID=\(operationID)")

        return try await next(authenticatedRequest, body, baseURL)
    }
}
