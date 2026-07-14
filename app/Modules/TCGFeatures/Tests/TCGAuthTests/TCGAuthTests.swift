//
//  TCGAuthTests.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/12/26.
//

import Foundation
import HTTPTypes
import OpenAPIRuntime
import TCGClient
import Testing

@testable import TCGAuth

@Suite("TCGAuth Tests")
@MainActor
struct TCGAuthTests {
    @Test
    func `Should not validate the token or load a session when credentials are missing`() async throws {
        let transport = RequestTransport.sessionSuccess()
        let auth = makeAuth(transport: transport, credentialsStore: CredentialsStoreSpy())

        #expect(auth.initiallyValidatingToken == false)
        #expect(auth.isLoggedIn == false)
        #expect(auth.session == nil)
        #expect(await transport.requests.isEmpty)
    }

    @Test
    func `Should begin validating the token when credentials are valid`() async throws {
        let credentialsStore = try validCredentialsStore()
        let auth = makeAuth(transport: RequestTransport.sessionSuccess(), credentialsStore: credentialsStore)

        #expect(auth.initiallyValidatingToken == true)
    }

    @Test
    func `Should load and store the session when credentials are valid`() async throws {
        let credentialsStore = try validCredentialsStore()
        let transport = RequestTransport.sessionSuccess()
        let cache = CachedUserSessionStoreSpy()

        let auth = makeAuth(transport: transport, credentialsStore: credentialsStore, cache: cache)
        await yield(until: { !auth.initiallyValidatingToken })

        let expectedSession = try expectedSession()
        #expect(auth.isLoggedIn == true)
        #expect(auth.session == expectedSession)
        #expect(cache.cachedSession?.session == expectedSession)
        let request = try #require(await transport.requests.last)
        #expect(await transport.requests.count == 1)
        #expect(request.method == .get)
        #expect(request.path == "/app-api/auth/session")
    }

    @Test
    func `Should keep no session when the server reports no session`() async throws {
        let credentialsStore = try validCredentialsStore()
        let transport = RequestTransport.notFound()

        let auth = makeAuth(transport: transport, credentialsStore: credentialsStore)
        await yield(until: { !auth.initiallyValidatingToken })

        #expect(auth.isLoggedIn == false)
        #expect(auth.session == nil)
    }

    @Test
    func `Should use the cached session without requesting a new one`() async throws {
        let cachedSession = UserSession(name: "Cached", email: "cached@example.com", expiresAt: .distantFuture)
        let cache = CachedUserSessionStoreSpy(
            cachedSession: CachedUserSession(session: cachedSession, cachedAt: .now)
        )
        let credentialsStore = try validCredentialsStore()
        let transport = RequestTransport.sessionSuccess()

        let auth = makeAuth(transport: transport, credentialsStore: credentialsStore, cache: cache)
        await yield(until: { !auth.initiallyValidatingToken })

        #expect(auth.session == cachedSession)
        #expect(await transport.requests.isEmpty)
    }

    @Test
    func `Should ignore an expired cached session and request a new one`() async throws {
        let expiredSession = UserSession(name: "Cached", email: "cached@example.com", expiresAt: .distantPast)
        let cache = CachedUserSessionStoreSpy(
            cachedSession: CachedUserSession(session: expiredSession, cachedAt: .now)
        )
        let credentialsStore = try validCredentialsStore()
        let transport = RequestTransport.sessionSuccess()

        let auth = makeAuth(transport: transport, credentialsStore: credentialsStore, cache: cache)
        await yield(until: { !auth.initiallyValidatingToken })

        #expect(auth.session == (try expectedSession()))
        #expect(await transport.requests.count == 1)
    }

    @Test
    func `Should ignore a cached session from a previous day and request a new one`() async throws {
        let staleSession = UserSession(name: "Cached", email: "cached@example.com", expiresAt: .distantFuture)
        let yesterday = try #require(Calendar.current.date(byAdding: .day, value: -1, to: .now))
        let cache = CachedUserSessionStoreSpy(
            cachedSession: CachedUserSession(session: staleSession, cachedAt: yesterday)
        )
        let credentialsStore = try validCredentialsStore()
        let transport = RequestTransport.sessionSuccess()

        let auth = makeAuth(transport: transport, credentialsStore: credentialsStore, cache: cache)
        await yield(until: { !auth.initiallyValidatingToken })

        #expect(auth.session == (try expectedSession()))
        #expect(await transport.requests.count == 1)
    }

    @Test
    func `Should not send a sign in request when local validation fails`() async throws {
        let transport = RequestTransport.sessionSuccess()
        let auth = makeAuth(transport: transport, credentialsStore: CredentialsStoreSpy())

        let result = await auth.signIn(email: "invalid", password: "1234567")

        let error = try #require(throws: TCGAuthOperationError.self) {
            try result.get()
        }
        #expect(
            error
                == .validation([
                    .init(field: .email, message: "Enter a valid email address."),
                    .init(field: .password, message: "Password must contain at least 8 characters."),
                ])
        )
        #expect(await transport.requests.isEmpty)
    }

    @Test
    func `Should sign in then load and cache the authenticated session`() async throws {
        let transport = try RequestTransport.authenticationSuccess(status: .ok)
        let credentialsStore = CredentialsStoreSpy()
        let cache = CachedUserSessionStoreSpy(
            cachedSession: CachedUserSession(
                session: UserSession(name: "Old User", email: "old@example.com", expiresAt: .distantFuture),
                cachedAt: .now
            )
        )
        let auth = makeAuth(transport: transport, credentialsStore: credentialsStore, cache: cache)

        try await auth.signIn(email: "jane@example.com", password: "password123").get()

        let requests = await transport.requests
        #expect(requests.count == 2)
        #expect(requests[0].method == .post)
        #expect(requests[0].path == "/app-api/auth/sign-in/email")
        let requestBody = try #require(requests[0].body)
        #expect(
            try JSONDecoder().decode(SignInPayload.self, from: requestBody)
                == .init(
                    email: "jane@example.com",
                    password: "password123"
                ))
        #expect(requests[1].method == .get)
        #expect(requests[1].path == "/app-api/auth/session")
        #expect(try credentialsStore.get(forKey: "credentials-key") != nil)
        #expect(auth.session == (try expectedSession()))
        #expect(cache.cachedSession?.session == (try expectedSession()))
    }

    @Test
    func `Should sign up then load and cache the authenticated session`() async throws {
        let transport = try RequestTransport.authenticationSuccess(status: .created)
        let credentialsStore = CredentialsStoreSpy()
        let cache = CachedUserSessionStoreSpy()
        let auth = makeAuth(transport: transport, credentialsStore: credentialsStore, cache: cache)

        try await auth.signUp(name: "Jane Doe", email: "jane@example.com", password: "password123").get()

        let requests = await transport.requests
        #expect(requests.count == 2)
        #expect(requests[0].method == .post)
        #expect(requests[0].path == "/app-api/auth/sign-up/email")
        let requestBody = try #require(requests[0].body)
        #expect(
            try JSONDecoder().decode(SignUpPayload.self, from: requestBody)
                == .init(
                    name: "Jane Doe",
                    email: "jane@example.com",
                    password: "password123"
                ))
        #expect(requests[1].method == .get)
        #expect(requests[1].path == "/app-api/auth/session")
        #expect(try credentialsStore.get(forKey: "credentials-key") != nil)
        #expect(auth.session == (try expectedSession()))
        #expect(cache.cachedSession?.session == (try expectedSession()))
    }

    @Test
    func `Should expose invalid credentials without loading a session`() async throws {
        let transport = RequestTransport.invalidCredentials()
        let auth = makeAuth(transport: transport, credentialsStore: CredentialsStoreSpy())

        let result = await auth.signIn(email: "jane@example.com", password: "password123")

        try #require(throws: TCGAuthOperationError.invalidCredentials) {
            try result.get()
        }
        #expect(auth.session == nil)
        #expect(await transport.requests.count == 1)
    }

    @Test
    func `Should expose session unavailable when sign in is unauthorized for a reason other than invalid credentials`()
        async throws
    {
        let transport = RequestTransport.unauthorized()
        let auth = makeAuth(transport: transport, credentialsStore: CredentialsStoreSpy())

        let result = await auth.signIn(email: "jane@example.com", password: "password123")

        try #require(throws: TCGAuthOperationError.sessionUnavailable) {
            try result.get()
        }
        #expect(auth.session == nil)
        #expect(await transport.requests.count == 1)
    }

    @Test
    func `Should expose session unavailable when sign up is unauthorized after account creation`() async throws {
        let transport = RequestTransport.unauthorized()
        let auth = makeAuth(transport: transport, credentialsStore: CredentialsStoreSpy())

        let result = await auth.signUp(name: "Jane Doe", email: "jane@example.com", password: "password123")

        try #require(throws: TCGAuthOperationError.sessionUnavailable) {
            try result.get()
        }
        #expect(auth.session == nil)
        #expect(await transport.requests.count == 1)
    }

    @Test
    func `Should expose a duplicate email without loading a session`() async throws {
        let transport = RequestTransport.conflict()
        let auth = makeAuth(transport: transport, credentialsStore: CredentialsStoreSpy())

        let result = await auth.signUp(name: "Jane Doe", email: "jane@example.com", password: "password123")

        try #require(throws: TCGAuthOperationError.emailAlreadyInUse) {
            try result.get()
        }
        #expect(auth.session == nil)
        #expect(await transport.requests.count == 1)
    }

    @Test
    func `Should map server validation issues to auth fields`() async throws {
        let transport = RequestTransport.validationError()
        let auth = makeAuth(transport: transport, credentialsStore: CredentialsStoreSpy())

        let result = await auth.signIn(email: "jane@example.com", password: "password123")

        try #require(
            throws: TCGAuthOperationError.validation([
                .init(field: .email, message: "Email address is invalid")
            ])
        ) {
            try result.get()
        }
        #expect(auth.session == nil)
    }

    @Test
    func `Should expose a server failure without loading a session`() async throws {
        let transport = RequestTransport.failing()
        let auth = makeAuth(transport: transport, credentialsStore: CredentialsStoreSpy())

        let result = await auth.signIn(email: "jane@example.com", password: "password123")

        try #require(throws: TCGAuthOperationError.serverUnavailable) {
            try result.get()
        }
        #expect(auth.session == nil)
    }

    @Test
    func `Should expose a missing session after successful authentication`() async throws {
        let transport = try RequestTransport.authenticationWithMissingSession(status: .ok)
        let auth = makeAuth(transport: transport, credentialsStore: CredentialsStoreSpy())

        let result = await auth.signIn(email: "jane@example.com", password: "password123")

        try #require(throws: TCGAuthOperationError.sessionUnavailable) {
            try result.get()
        }
        #expect(auth.session == nil)
        #expect(await transport.requests.count == 2)
    }

}
