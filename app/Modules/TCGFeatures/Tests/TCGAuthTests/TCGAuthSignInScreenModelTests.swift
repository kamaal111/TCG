//
//  TCGAuthSignInScreenModelTests.swift
//  TCGFeatures
//
//  Created by Codex on 7/16/26.
//

import Testing

@testable import TCGAuth

@Suite("TCGAuth Sign In Screen Model Tests")
@MainActor
struct TCGAuthSignInScreenModelTests {
    @Test
    func `Should validate an edited field and clear its corrected error`() {
        let model = TCGAuthSignInScreenModel()
        model.email = "invalid"

        model.validate(.email)
        #expect(model.fieldErrors[.email] == "Enter a valid email address.")

        model.email = "jane@example.com"
        #expect(model.fieldErrors[.email] == nil)
    }

    @Test
    func `Should ignore name validation while logging in`() {
        let model = TCGAuthSignInScreenModel()
        model.name = "Al"

        model.validate(.name)

        #expect(model.fieldErrors[.name] == nil)
    }

    @Test
    func `Should ignore verification validation while logging in`() {
        let model = TCGAuthSignInScreenModel()
        model.email = "jane@example.com"
        model.verifyEmail = "jane@exampl.com"
        model.password = "password123"
        model.verifyPassword = "password321"

        model.validate(.verifyEmail)
        model.validate(.verifyPassword)

        #expect(model.fieldErrors[.verifyEmail] == nil)
        #expect(model.fieldErrors[.verifyPassword] == nil)
    }

    @Test
    func `Should clear a corrected verify email error`() {
        let model = TCGAuthSignInScreenModel()
        model.mode = .signUp
        model.email = "Jane@example.com"
        model.verifyEmail = "jane@example.com"

        model.validate(.verifyEmail)
        #expect(model.fieldErrors[.verifyEmail] == "Email addresses do not match.")

        model.verifyEmail = "Jane@example.com"
        #expect(model.fieldErrors[.verifyEmail] == nil)
    }

    @Test
    func `Should show field errors and a toast without requesting an invalid sign up`() async {
        let transport = RequestTransport.sessionSuccess()
        let auth = makeAuth(transport: transport)
        let model = TCGAuthSignInScreenModel()
        model.mode = .signUp

        await model.submit(using: auth)

        #expect(model.fieldErrors.keys.contains(.name))
        #expect(model.fieldErrors.keys.contains(.email))
        #expect(model.fieldErrors.keys.contains(.password))
        #expect(model.toast?.message == "Please correct the highlighted fields.")
        #expect(await transport.requests.isEmpty)
    }

    @Test
    func `Should prevent a sign up request when email verification does not match`() async {
        let transport = RequestTransport.sessionSuccess()
        let auth = makeAuth(transport: transport)
        let model = TCGAuthSignInScreenModel()
        model.mode = .signUp
        model.name = "Jane Doe"
        model.email = "jane@example.com"
        model.verifyEmail = "jane@exampl.com"
        model.password = "password123"
        model.verifyPassword = "password123"

        await model.submit(using: auth)

        #expect(model.fieldErrors[.verifyEmail] == "Email addresses do not match.")
        #expect(model.toast?.message == "Please correct the highlighted fields.")
        #expect(await transport.requests.isEmpty)
    }

    @Test
    func `Should prevent a sign up request when password verification does not match`() async {
        let transport = RequestTransport.sessionSuccess()
        let auth = makeAuth(transport: transport)
        let model = TCGAuthSignInScreenModel()
        model.mode = .signUp
        model.name = "Jane Doe"
        model.email = "jane@example.com"
        model.verifyEmail = "jane@example.com"
        model.password = "password123"
        model.verifyPassword = "password321"

        await model.submit(using: auth)

        #expect(model.fieldErrors[.verifyPassword] == "Passwords do not match.")
        #expect(model.toast?.message == "Please correct the highlighted fields.")
        #expect(await transport.requests.isEmpty)
    }

    @Test
    func `Should clear field errors and a toast when changing modes`() async {
        let auth = makeAuth(transport: .unauthorized())
        let model = TCGAuthSignInScreenModel()
        model.email = "jane@example.com"
        model.password = "password123"

        await model.submit(using: auth)
        model.validate(.email)
        model.mode = .signUp

        #expect(model.fieldErrors.isEmpty)
        #expect(model.toast == nil)
    }

    @Test
    func `Should show an invalid credentials toast`() async {
        let auth = makeAuth(transport: .invalidCredentials())
        let model = TCGAuthSignInScreenModel()
        model.email = "jane@example.com"
        model.password = "password123"

        await model.submit(using: auth)

        #expect(model.toast?.message == "The email or password is incorrect.")
        #expect(model.isSubmitting == false)
    }

    @Test
    func `Should show server validation beneath its field and in a toast`() async {
        let auth = makeAuth(transport: .validationError())
        let model = TCGAuthSignInScreenModel()
        model.email = "jane@example.com"
        model.password = "password123"

        await model.submit(using: auth)

        #expect(model.fieldErrors[.email] == "Email address is invalid")
        #expect(model.toast?.message == "Please correct the highlighted fields.")
    }

    @Test
    func `Should prevent duplicate submissions while authentication is loading`() async {
        let gate = RequestGate()
        let transport = RequestTransport.unauthorized(gate: gate)
        let auth = makeAuth(transport: transport)
        let model = TCGAuthSignInScreenModel()
        model.email = "jane@example.com"
        model.password = "password123"

        let submission = Task { await model.submit(using: auth) }
        await yield(until: { model.isSubmitting })
        await yield(until: transport, hasRequestCount: 1)
        await model.submit(using: auth)

        #expect(await transport.requests.count == 1)
        await gate.release()
        await submission.value
        #expect(model.isSubmitting == false)
    }

}
