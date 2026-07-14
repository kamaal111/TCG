//
//  TCGAuthTestHelpers.swift
//  TCGFeatures
//
//  Created by Codex on 7/16/26.
//

import Foundation
import TCGClient
import Testing

@testable import TCGAuth

@MainActor
func makeAuth(
    transport: RequestTransport,
    credentialsStore: CredentialsStore = CredentialsStoreSpy(),
    cache: CachedUserSessionStoreSpy = CachedUserSessionStoreSpy()
) -> TCGAuth {
    let client = TCGClient.default(
        transport: transport,
        credentialsKeychainKey: "credentials-key",
        credentialsStore: credentialsStore
    )

    return TCGAuth(client: client, cachedSessionStore: cache)
}

func validCredentialsStore() throws -> CredentialsStoreSpy {
    let credentials = Credentials(
        authToken: "auth-token",
        expiryDate: .distantFuture,
        sessionToken: "session-token",
        sessionUpdateAge: 1800,
        lastSessionUpdate: .now
    )

    return CredentialsStoreSpy(initialData: try JSONEncoder().encode(credentials))
}

func expectedSession() throws -> UserSession {
    let expiresAt = try #require(ISO8601DateFormatter().date(from: "2026-08-12T12:00:00Z"))

    return UserSession(name: "Jane Doe", email: "jane@example.com", expiresAt: expiresAt)
}

@MainActor
func yield(until condition: @MainActor () -> Bool, iterations: Int = 1000) async {
    var count = 0
    while !condition(), count < iterations {
        await Task.yield()
        count += 1
    }
}

@MainActor
func yield(until transport: RequestTransport, hasRequestCount count: Int, iterations: Int = 1000) async {
    var iteration = 0
    while await transport.requests.count != count, iteration < iterations {
        await Task.yield()
        iteration += 1
    }
}
