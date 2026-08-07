//
//  PreviewTCGClientTests.swift
//  TCGClient
//
//  Created by Kamaal M Farah on 7/19/26.
//

import Foundation
import KamaalAuth
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
        let auth = PreviewKamaalAuthClient(
            hasValidCredentials: true,
            session: AuthSession(
                id: "preview-user",
                name: "Jane Doe",
                email: "jane@example.com",
                emailVerified: true,
                createdAt: .now,
                expiresAt: expiryDate,
            )
        )

        let session = try await auth.session().get()

        #expect(session.name == "Jane Doe")
        #expect(session.email == "jane@example.com")
        #expect(session.expiresAt == expiryDate)
    }

    @Test
    func `Should return invalid credentials when configured`() async {
        let client = TCGClient.preview(authOutcome: .invalidCredentials)

        await #expect(throws: SignInErrors.badRequest(validations: [])) {
            try await client.auth.signIn(with: .init(email: "jane@example.com", password: "Password123!")).get()
        }
    }

    @Test
    func `Should return configured validation errors when signing in`() async {
        let issue = AuthValidationIssue(code: "invalid_format", path: ["email"], message: "Email is invalid")
        let client = TCGClient.preview(authOutcome: .validation(issues: [issue]))

        await #expect(throws: SignInErrors.badRequest(validations: [issue])) {
            try await client.auth.signIn(with: .init(email: "jane@example.com", password: "Password123!")).get()
        }
    }

    @Test
    func `Should return session unavailable when configured`() async {
        let client = TCGClient.preview(authOutcome: .sessionUnavailable)

        await #expect(throws: SignInErrors.sessionUnavailable) {
            try await client.auth.signIn(with: .init(email: "jane@example.com", password: "Password123!")).get()
        }
        await #expect(throws: SignUpErrors.sessionUnavailable) {
            try await client.auth.signUp(
                with: .init(email: "jane@example.com", password: "Password123!", name: "Jane Doe")
            ).get()
        }
    }

    @Test
    func `Should return an unknown error when the server is unavailable`() async {
        let client = TCGClient.preview(authOutcome: .serverUnavailable)

        await #expect(throws: SignInErrors.unknown(status: 503, payload: nil, cause: nil)) {
            try await client.auth.signIn(with: .init(email: "jane@example.com", password: "Password123!")).get()
        }
        await #expect(throws: SignUpErrors.unknown(status: 503, payload: nil, cause: nil)) {
            try await client.auth.signUp(
                with: .init(email: "jane@example.com", password: "Password123!", name: "Jane Doe")
            ).get()
        }
    }

    @Test
    func `Should return a conflict when the email is already in use`() async {
        let client = TCGClient.preview(authOutcome: .emailAlreadyInUse)

        await #expect(throws: SignUpErrors.conflict) {
            try await client.auth.signUp(
                with: .init(email: "jane@example.com", password: "Password123!", name: "Jane Doe")
            ).get()
        }
    }
}
