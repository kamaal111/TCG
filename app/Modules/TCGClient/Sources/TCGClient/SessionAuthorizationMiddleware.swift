//
//  SessionAuthorizationMiddleware.swift
//  TCGClient
//
//  Created by Kamaal M Farah on 7/12/26.
//

import Foundation
import HTTPTypes
import OpenAPIRuntime

struct SessionAuthorizationMiddleware: ClientMiddleware {
    let credentialsKeychainKey: String
    let credentialsStore: any CredentialsStore

    func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @concurrent @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        guard let credentials = try await credentialsStore.credentials(forKey: credentialsKeychainKey) else {
            return try await next(request, body, baseURL)
        }

        guard !credentials.hasExpired else {
            try await credentialsStore.delete(forKey: credentialsKeychainKey)

            return try await next(request, body, baseURL)
        }

        var authenticatedRequest = request
        authenticatedRequest.headerFields[.authorization] = "Bearer \(credentials.authToken)"

        return try await next(authenticatedRequest, body, baseURL)
    }
}
