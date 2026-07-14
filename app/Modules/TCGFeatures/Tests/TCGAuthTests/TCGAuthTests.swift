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
    func `Should sign in and load the session on success`() async throws {
        let credentialsStore = CredentialsStoreSpy()
        let transport = try RequestTransport.signInThenSession()
        let cache = CachedUserSessionStoreSpy()
        let auth = makeAuth(transport: transport, credentialsStore: credentialsStore, cache: cache)

        let result = await auth.signIn(email: "jane@example.com", password: "Password123!")

        try result.get()
        let expectedSession = try expectedSession()
        #expect(auth.isLoggedIn == true)
        #expect(auth.session == expectedSession)
        #expect(auth.isAuthenticating == false)
        #expect(cache.cachedSession?.session == expectedSession)
        #expect(credentialsStore.hasStoredData == true)
        let requests = await transport.requests
        let signInRequest = try #require(requests.first)
        let sessionRequest = try #require(requests.last)
        #expect(requests.count == 2)
        #expect(signInRequest.method == .post)
        #expect(signInRequest.path == "/app-api/auth/sign-in/email")
        #expect(sessionRequest.method == .get)
        #expect(sessionRequest.path == "/app-api/auth/session")
        let signInBody = try #require(signInRequest.body)
        let signInPayload = try JSONDecoder().decode(SignInPayload.self, from: signInBody)
        #expect(signInPayload == SignInPayload(email: "jane@example.com", password: "Password123!"))
    }

    @Test
    func `Should replace a same-day cached session when signing in`() async throws {
        let staleSession = UserSession(name: "Cached", email: "cached@example.com", expiresAt: .distantFuture)
        let cache = CachedUserSessionStoreSpy(
            cachedSession: CachedUserSession(session: staleSession, cachedAt: .now)
        )
        let transport = try RequestTransport.signInThenSession()
        let auth = makeAuth(transport: transport, credentialsStore: CredentialsStoreSpy(), cache: cache)

        let result = await auth.signIn(email: "jane@example.com", password: "Password123!")

        try result.get()
        #expect(auth.session == (try expectedSession()))
        #expect(await transport.requests.count == 2)
    }

    @Test
    func `Should surface invalid credentials when sign in is rejected`() async throws {
        let credentialsStore = CredentialsStoreSpy()
        let transport = RequestTransport.unauthorized()
        let auth = makeAuth(transport: transport, credentialsStore: credentialsStore)

        let result = await auth.signIn(email: "jane@example.com", password: "Password123!")

        try #require(throws: TCGAuthSignInError.invalidCredentials) {
            try result.get()
        }
        #expect(auth.isLoggedIn == false)
        #expect(auth.session == nil)
        #expect(credentialsStore.hasStoredData == false)
        let requests = await transport.requests
        #expect(requests.count == 1)
        #expect(requests.first?.path == "/app-api/auth/sign-in/email")
    }

    @Test
    func `Should sign up and load the session on success`() async throws {
        let credentialsStore = CredentialsStoreSpy()
        let transport = try RequestTransport.signUpThenSession()
        let cache = CachedUserSessionStoreSpy()
        let auth = makeAuth(transport: transport, credentialsStore: credentialsStore, cache: cache)

        let result = await auth.signUp(name: "Jane Doe", email: "jane@example.com", password: "Password123!")

        try result.get()
        let expectedSession = try expectedSession()
        #expect(auth.isLoggedIn == true)
        #expect(auth.session == expectedSession)
        #expect(auth.isAuthenticating == false)
        #expect(cache.cachedSession?.session == expectedSession)
        #expect(credentialsStore.hasStoredData == true)
        let requests = await transport.requests
        let signUpRequest = try #require(requests.first)
        let sessionRequest = try #require(requests.last)
        #expect(requests.count == 2)
        #expect(signUpRequest.method == .post)
        #expect(signUpRequest.path == "/app-api/auth/sign-up/email")
        #expect(sessionRequest.method == .get)
        #expect(sessionRequest.path == "/app-api/auth/session")
        let signUpBody = try #require(signUpRequest.body)
        let signUpPayload = try JSONDecoder().decode(SignUpPayload.self, from: signUpBody)
        #expect(
            signUpPayload
                == SignUpPayload(
                    name: "Jane Doe",
                    email: "jane@example.com",
                    password: "Password123!"
                ))
    }

    @Test
    func `Should surface a conflict when the email is already registered`() async throws {
        let transport = RequestTransport.conflict()
        let auth = makeAuth(transport: transport, credentialsStore: CredentialsStoreSpy())

        let result = await auth.signUp(name: "Jane Doe", email: "jane@example.com", password: "Password123!")

        try #require(throws: TCGAuthSignUpError.emailTaken) {
            try result.get()
        }
        #expect(auth.isLoggedIn == false)
        let requests = await transport.requests
        #expect(requests.count == 1)
        #expect(requests.first?.path == "/app-api/auth/sign-up/email")
    }

    @Test
    func `Should surface the server validation message on a bad sign up request`() async throws {
        let transport = RequestTransport.validationError()
        let auth = makeAuth(transport: transport, credentialsStore: CredentialsStoreSpy())

        let result = await auth.signUp(name: "Jane Doe", email: "jane@example.com", password: "Password123!")

        try #require(throws: TCGAuthSignUpError.invalidPayload(message: "Email address is invalid")) {
            try result.get()
        }
        #expect(auth.isLoggedIn == false)
    }

    private func makeAuth(
        transport: RequestTransport,
        credentialsStore: CredentialsStore,
        cache: CachedUserSessionStoreSpy = CachedUserSessionStoreSpy()
    ) -> TCGAuth {
        let client = TCGClient.default(
            transport: transport,
            credentialsKeychainKey: "credentials-key",
            credentialsStore: credentialsStore
        )

        return TCGAuth(client: client, cachedSessionStore: cache)
    }

    private func validCredentialsStore() throws -> CredentialsStoreSpy {
        let credentials = Credentials(
            authToken: "auth-token",
            expiryDate: .distantFuture,
            sessionToken: "session-token",
            sessionUpdateAge: 1800,
            lastSessionUpdate: .now
        )

        return CredentialsStoreSpy(initialData: try JSONEncoder().encode(credentials))
    }

    private func expectedSession() throws -> UserSession {
        let expiresAt = try #require(ISO8601DateFormatter().date(from: "2026-08-12T12:00:00Z"))

        return UserSession(name: "Jane Doe", email: "jane@example.com", expiresAt: expiresAt)
    }

    private func yield(until condition: @MainActor () -> Bool, iterations: Int = 1000) async {
        var count = 0
        while !condition(), count < iterations {
            await Task.yield()
            count += 1
        }
    }
}

@MainActor
private final class CachedUserSessionStoreSpy: CachedUserSessionStore {
    var cachedSession: CachedUserSession?

    init(cachedSession: CachedUserSession? = nil) {
        self.cachedSession = cachedSession
    }
}

private actor RequestTransport: ClientTransport {
    private(set) var requests: [RecordedRequest] = []
    private let defaultResponse: CannedResponse?
    private let responsesByOperationID: [String: CannedResponse]

    private init(
        defaultResponse: CannedResponse?,
        responsesByOperationID: [String: CannedResponse] = [:]
    ) {
        self.defaultResponse = defaultResponse
        self.responsesByOperationID = responsesByOperationID
    }

    func send(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL _: URL,
        operationID: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        let requestBody: Data?
        if let body {
            requestBody = try await .init(collecting: body, upTo: .max)
        } else {
            requestBody = nil
        }
        requests.append(
            .init(method: request.method, path: request.path, operationID: operationID, body: requestBody)
        )

        guard let canned = responsesByOperationID[operationID] ?? defaultResponse else {
            throw RequestTransportError.failed
        }

        return (canned.response, canned.body.map(HTTPBody.init))
    }

    static func sessionSuccess() -> RequestTransport {
        RequestTransport(defaultResponse: .sessionSuccess())
    }

    static func notFound() -> RequestTransport {
        RequestTransport(defaultResponse: .notFound())
    }

    static func unauthorized() -> RequestTransport {
        RequestTransport(defaultResponse: .unauthorized())
    }

    static func conflict() -> RequestTransport {
        RequestTransport(defaultResponse: .conflict())
    }

    static func validationError() -> RequestTransport {
        RequestTransport(defaultResponse: .validationError())
    }

    static func signInThenSession() throws -> RequestTransport {
        RequestTransport(
            defaultResponse: nil,
            responsesByOperationID: [
                "post/app-api/auth/sign-in/email": try .authSuccess(status: .ok),
                "get/app-api/auth/session": .sessionSuccess(),
            ]
        )
    }

    static func signUpThenSession() throws -> RequestTransport {
        RequestTransport(
            defaultResponse: nil,
            responsesByOperationID: [
                "post/app-api/auth/sign-up/email": try .authSuccess(status: .created),
                "get/app-api/auth/session": .sessionSuccess(),
            ]
        )
    }
}

private struct CannedResponse: Sendable {
    let response: HTTPResponse
    let body: Data?

    static func sessionSuccess() -> CannedResponse {
        CannedResponse(
            response: .init(status: .ok, headerFields: [.contentType: "application/json"]),
            body: Data(
                """
                {
                  "session": {
                    "expires_at": "2026-08-12T12:00:00Z",
                    "created_at": "2026-07-12T12:00:00Z",
                    "updated_at": "2026-07-12T12:00:00Z"
                  },
                  "user": {
                    "id": "user-id",
                    "created_at": "2026-07-12T12:00:00Z",
                    "email": "jane@example.com",
                    "email_verified": false,
                    "name": "Jane Doe"
                  }
                }
                """.utf8)
        )
    }

    static func authSuccess(status: HTTPResponse.Status) throws -> CannedResponse {
        let authTokenHeader = try #require(HTTPField.Name("set-auth-token"))
        let authTokenExpiryHeader = try #require(HTTPField.Name("set-auth-token-expiry"))
        let sessionTokenHeader = try #require(HTTPField.Name("set-session-token"))
        let sessionUpdateAgeHeader = try #require(HTTPField.Name("set-session-update-age"))

        return CannedResponse(
            response: .init(
                status: status,
                headerFields: [
                    .contentType: "application/json",
                    authTokenHeader: "auth-token",
                    authTokenExpiryHeader: "86400",
                    sessionTokenHeader: "session-token",
                    sessionUpdateAgeHeader: "1800",
                ]),
            body: Data(
                """
                {
                  "token": "auth-token",
                  "user": {
                    "id": "user-id",
                    "created_at": "2026-07-12T12:00:00Z",
                    "email": "jane@example.com",
                    "email_verified": false,
                    "name": "Jane Doe"
                  }
                }
                """.utf8)
        )
    }

    static func notFound() -> CannedResponse {
        CannedResponse(
            response: .init(status: .notFound, headerFields: [.contentType: "application/json"]),
            body: Data("{ \"message\": \"Not found\", \"code\": \"NOT_FOUND\" }".utf8)
        )
    }

    static func unauthorized() -> CannedResponse {
        CannedResponse(
            response: .init(status: .unauthorized, headerFields: [.contentType: "application/json"]),
            body: Data(
                """
                {
                  "message": "Invalid email or password",
                  "code": "INVALID_EMAIL_OR_PASSWORD"
                }
                """.utf8)
        )
    }

    static func conflict() -> CannedResponse {
        CannedResponse(
            response: .init(status: .conflict, headerFields: [.contentType: "application/json"]),
            body: Data(
                """
                {
                  "message": "User already exists",
                  "code": "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"
                }
                """.utf8)
        )
    }

    static func validationError() -> CannedResponse {
        CannedResponse(
            response: .init(status: .badRequest, headerFields: [.contentType: "application/json"]),
            body: Data(
                """
                {
                  "message": "Invalid payload",
                  "code": "INVALID_PAYLOAD",
                  "context": {
                    "validations": [
                      {
                        "code": "invalid_format",
                        "path": ["email"],
                        "message": "Email address is invalid"
                      }
                    ]
                  }
                }
                """.utf8)
        )
    }
}

private struct RecordedRequest: Sendable {
    let method: HTTPRequest.Method
    let path: String?
    let operationID: String
    let body: Data?
}

private enum RequestTransportError: Error {
    case failed
}

private final class CredentialsStoreSpy: CredentialsStore, @unchecked Sendable {
    private let lock = NSLock()
    private var storedData: Data?

    init(initialData: Data? = nil) {
        self.storedData = initialData
    }

    var hasStoredData: Bool {
        lock.lock()
        defer { lock.unlock() }

        return storedData != nil
    }

    func delete(forKey _: String) throws {
        lock.lock()
        defer { lock.unlock() }

        storedData = nil
    }

    func get(forKey _: String) throws -> Data? {
        lock.lock()
        defer { lock.unlock() }

        return storedData
    }

    func set(_ data: Data, forKey _: String) throws {
        lock.lock()
        defer { lock.unlock() }

        storedData = data
    }
}
