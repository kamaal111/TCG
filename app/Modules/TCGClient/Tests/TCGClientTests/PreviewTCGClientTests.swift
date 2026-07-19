//
//  PreviewTCGClientTests.swift
//  TCGClient
//
//  Created by Kamaal M Farah on 7/19/26.
//

import Foundation
import Testing

@testable import TCGClient

@Suite("Preview TCGClient Tests")
struct PreviewTCGClientTests {
    @Test
    func `Should report no valid credentials by default`() {
        let client = TCGClient.preview()

        #expect(client.hasValidCredentials == false)
    }

    @Test
    func `Should report valid credentials when seeded as signed in`() {
        let client = TCGClient.preview(hasValidCredentials: true)

        #expect(client.hasValidCredentials == true)
    }

    @Test
    func `Should return the fully static session when no credentials are stored`() async throws {
        let client = TCGClient.preview()

        let session = try await client.auth.session().get()

        #expect(session.name == "Jane Doe")
        #expect(session.email == "jane@example.com")
        #expect(session.expiresAt == .distantFuture)
    }

    @Test
    func `Should derive the session expiry from the stored credentials`() async throws {
        let expiryDate = try #require(ISO8601DateFormatter().date(from: "2026-08-12T12:00:00Z"))
        let credentials = Credentials(
            authToken: "preview-auth-token",
            expiryDate: expiryDate,
            sessionToken: "preview-session-token",
            sessionUpdateAge: 1800,
            lastSessionUpdate: .now
        )
        let credentialsStore = InMemoryCredentialsStore(seed: try JSONEncoder().encode(credentials))
        let auth = PreviewTCGAuthClient(
            credentialsStore: credentialsStore,
            credentialsKeychainKey: "credentials-key"
        )

        let session = try await auth.session().get()

        #expect(session.name == "Jane Doe")
        #expect(session.email == "jane@example.com")
        #expect(session.expiresAt == expiryDate)
    }

    @Test
    func `Should succeed on refresh, sign in, and sign up without network`() async throws {
        let client = TCGClient.preview()

        try await client.auth.refreshToken().get()
        try await client.auth.signIn(with: .init(email: "jane@example.com", password: "Password123!")).get()
        try await client.auth.signUp(
            with: .init(name: "Jane Doe", email: "jane@example.com", password: "Password123!")
        ).get()
    }
}
