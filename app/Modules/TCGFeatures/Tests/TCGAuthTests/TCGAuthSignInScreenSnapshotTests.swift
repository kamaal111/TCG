//
//  TCGAuthSignInScreenSnapshotTests.swift
//  TCGFeatures
//
//  Created by Codex on 7/19/26.
//

import SwiftUI
import TCGSnapshotTesting
import Testing

@testable import TCGAuth
@testable import TCGClient

@Suite("TCGAuth Sign In Screen Snapshot Tests")
@MainActor
struct TCGAuthSignInScreenSnapshotTests {
    @Test
    func `Renders the sign in screen`() {
        let auth = TCGAuth(client: .preview(), cachedSessionStore: CachedUserSessionStoreSpy())

        assertScreenSnapshot(testName: #function) { makeScreen(auth: auth) }
    }

    @Test
    func `Renders the signed in screen after signing up`() async {
        let auth = TCGAuth(client: .preview(), cachedSessionStore: CachedUserSessionStoreSpy())

        _ = await auth.signUp(name: "Jane Doe", email: "jane@example.com", password: "Password123!")

        #expect(auth.isLoggedIn)
        assertScreenSnapshot(testName: #function) { makeScreen(auth: auth) }
    }

    @Test
    func `Renders login validation errors`() async {
        let auth = TCGAuth(client: .preview(), cachedSessionStore: CachedUserSessionStoreSpy())
        let model = await makeSubmittedModel(auth: auth, email: "invalid", password: "short")

        assertScreenSnapshot(testName: #function) { makeDrivenScreen(auth: auth, model: model) }
    }

    @Test
    func `Renders sign up validation errors`() async {
        let auth = TCGAuth(client: .preview(), cachedSessionStore: CachedUserSessionStoreSpy())
        let model = await makeSubmittedModel(
            auth: auth,
            mode: .signUp,
            name: "Al",
            email: "invalid",
            verifyEmail: "other@example.com",
            password: "short",
            verifyPassword: "different"
        )

        assertScreenSnapshot(testName: #function) { makeDrivenScreen(auth: auth, model: model) }
    }

    @Test
    func `Renders the invalid credentials error`() async {
        let auth = TCGAuth(
            client: .preview(authOutcome: .invalidCredentials),
            cachedSessionStore: CachedUserSessionStoreSpy()
        )
        let model = await makeSubmittedModel(auth: auth, email: "jane@example.com", password: "Password123!")

        assertScreenSnapshot(testName: #function) { makeDrivenScreen(auth: auth, model: model) }
    }

    @Test
    func `Renders a server field validation error`() async {
        let issue = TCGClientValidationIssue(
            code: "invalid_format",
            path: ["email"],
            message: "Email address is invalid"
        )
        let auth = TCGAuth(
            client: .preview(authOutcome: .validationErrors([issue])),
            cachedSessionStore: CachedUserSessionStoreSpy()
        )
        let model = await makeSubmittedModel(auth: auth, email: "jane@example.com", password: "Password123!")

        assertScreenSnapshot(testName: #function) { makeDrivenScreen(auth: auth, model: model) }
    }

    private func makeScreen(auth: TCGAuth) -> some View {
        Text("Signed in")
            .tcgAuth(auth)
    }

    private func makeDrivenScreen(auth: TCGAuth, model: TCGAuthSignInScreenModel) -> some View {
        NavigationStack {
            TCGAuthSignInScreen(model: model)
        }
        .environment(auth)
    }

    private func makeSubmittedModel(
        auth: TCGAuth,
        mode: TCGAuthSignInScreenModel.Mode = .login,
        name: String = "",
        email: String = "",
        verifyEmail: String = "",
        password: String = "",
        verifyPassword: String = ""
    ) async -> TCGAuthSignInScreenModel {
        let model = TCGAuthSignInScreenModel()
        model.mode = mode
        model.name = name
        model.email = email
        model.verifyEmail = verifyEmail
        model.password = password
        model.verifyPassword = verifyPassword
        await model.submit(using: auth)

        return model
    }
}
