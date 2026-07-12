//
//  SessionAuthorizationMiddleware.swift
//  TCGClient
//
//  Created by Kamaal M Farah on 7/12/26.
//

import Foundation
import HTTPTypes
import OpenAPIRuntime
import TCGUtils

struct SessionAuthorizationMiddleware: ClientMiddleware {
    let credentialsKeychainKey: String
    let credentialsStore: any CredentialsStore
    let tokenRefresher: TokenRefresher?

    func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @concurrent @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        guard var credentials = try credentialsStore.credentials(forKey: credentialsKeychainKey) else {
            return try await next(request, body, baseURL)
        }

        guard !credentials.hasExpired else {
            try credentialsStore.delete(forKey: credentialsKeychainKey)

            return try await next(request, body, baseURL)
        }

        if credentials.shouldUpdateSession || credentials.willExpireSoon() {
            guard let tokenRefresher else {
                return try await authenticatedRequest(
                    from: credentials,
                    request: request,
                    body: body,
                    baseURL: baseURL,
                    next: next
                )
            }

            try await tokenRefresher.refreshToken().get()

            let refreshedCredentials = try credentialsStore.credentials(
                forKey: credentialsKeychainKey
            )
            guard let refreshedCredentials else { throw SessionErrors.unauthorized }

            credentials = refreshedCredentials
        }

        return try await authenticatedRequest(
            from: credentials,
            request: request,
            body: body,
            baseURL: baseURL,
            next: next
        )
    }

    private func authenticatedRequest(
        from credentials: Credentials,
        request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        next: @concurrent @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        var authenticatedRequest = request
        authenticatedRequest.headerFields[.authorization] = "Bearer \(credentials.authToken)"

        return try await next(authenticatedRequest, body, baseURL)
    }
}
