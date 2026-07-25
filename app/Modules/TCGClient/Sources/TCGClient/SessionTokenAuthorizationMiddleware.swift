//
//  SessionTokenAuthorizationMiddleware.swift
//  TCGClient
//

import Foundation
import HTTPTypes
import KamaalLogger
import OpenAPIRuntime

private let logger = KamaalLogger(from: SessionTokenAuthorizationMiddleware.self)

struct SessionTokenAuthorizationMiddleware: ClientMiddleware {
    let credentialsKeychainKey: String
    let credentialsStore: any CredentialsStore

    func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @concurrent @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        let credentials = try credentialsStore.credentials(forKey: credentialsKeychainKey)
        guard let credentials else { return try await next(request, body, baseURL) }

        var authenticatedRequest = request
        authenticatedRequest.headerFields[.authorization] = "Bearer \(credentials.sessionToken)"
        logger.info("Attached authentication credential; credential=session_token; operationID=\(operationID)")

        return try await next(authenticatedRequest, body, baseURL)
    }
}
