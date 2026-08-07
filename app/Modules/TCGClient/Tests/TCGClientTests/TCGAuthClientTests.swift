//
//  TCGAuthClientTests.swift
//  TCGClient
//
//  Created by Kamaal M Farah on 7/11/26.
//

import Foundation
import HTTPTypes
import KamaalAuth
import OpenAPIRuntime
import Testing

@testable import TCGClient

@Suite("TCGClient Auth Tests")
struct TCGAuthClientTests {
    @Test
    func `Should refresh the token and store refreshed credentials`() async throws {
        let credentialsStore = try CredentialsStoreSpy(
            initialData: JSONEncoder().encode(makeCredentials(expiryDate: .distantFuture))
        )
        let transport = try RequestTransport.tokenSuccess()
        let client = TCGClient.default(
            transport: transport,
            credentialsKeychainKey: "credentials-key",
            credentialsStore: credentialsStore
        )

        let result = await client.auth.refreshToken()

        try result.get()
        try await assertRefreshTokenRequest(in: transport)
        let storedCredentials = try #require(credentialsStore.storedCredentials)
        let credentials = try JSONDecoder().decode(Credentials.self, from: storedCredentials.data)
        #expect(storedCredentials.key == "credentials-key")
        #expect(credentials.authToken == "auth-token")
        #expect(credentials.sessionToken == "session-token")
    }

    @Test
    func `Should delete credentials and return unauthorized when token refresh is unauthorized`() async throws {
        let credentialsStore = try CredentialsStoreSpy(
            initialData: JSONEncoder().encode(makeCredentials(expiryDate: .distantFuture))
        )
        let transport = RequestTransport.unauthorized()
        let client = TCGClient.default(
            transport: transport,
            credentialsKeychainKey: "credentials-key",
            credentialsStore: credentialsStore
        )

        let result = await client.auth.refreshToken()

        #expect(throws: SessionErrors.unauthorized) {
            try result.get()
        }
        try await assertRefreshTokenRequest(in: transport)
        #expect(credentialsStore.deletedKeys == ["credentials-key"])
        #expect(credentialsStore.storedCredentialsData == nil)
    }

    @Test
    func `Should delete credentials and return unauthorized when token refresh finds no session`() async throws {
        let credentialsStore = try CredentialsStoreSpy(
            initialData: JSONEncoder().encode(makeCredentials(expiryDate: .distantFuture))
        )
        let client = TCGClient.default(
            transport: RequestTransport.notFound(),
            credentialsKeychainKey: "credentials-key",
            credentialsStore: credentialsStore
        )

        let result = await client.auth.refreshToken()

        #expect(throws: SessionErrors.unauthorized) {
            try result.get()
        }
        #expect(credentialsStore.deletedKeys == ["credentials-key"])
        #expect(credentialsStore.storedCredentialsData == nil)
    }

    @Test
    func `Should return an unknown error when token refresh transport fails`() async throws {
        let credentialsStore = try CredentialsStoreSpy(
            initialData: JSONEncoder().encode(makeCredentials(expiryDate: .distantFuture))
        )
        let client = TCGClient.default(
            transport: RequestTransport.failing(),
            credentialsKeychainKey: "credentials-key",
            credentialsStore: credentialsStore
        )

        let result = await client.auth.refreshToken()

        #expect(throws: SessionErrors.unknown(status: 503, payload: nil, cause: nil)) {
            try result.get()
        }
    }

    @Test
    func `Should preserve undocumented token refresh response statuses`() async throws {
        let credentialsStore = try CredentialsStoreSpy(
            initialData: JSONEncoder().encode(makeCredentials(expiryDate: .distantFuture))
        )
        let client = TCGClient.default(
            transport: RequestTransport.undocumented(),
            credentialsKeychainKey: "credentials-key",
            credentialsStore: credentialsStore
        )

        let result = await client.auth.refreshToken()

        #expect(throws: SessionErrors.unknown(status: 502, payload: nil, cause: nil)) {
            try result.get()
        }
    }

    @Test
    func `Should refresh the token before authenticated requests when the session needs an update`() async throws {
        let credentialsStore = try CredentialsStoreSpy(
            initialData: JSONEncoder().encode(
                makeCredentials(expiryDate: .distantFuture, lastSessionUpdate: .distantPast)
            )
        )
        let transport = try RequestTransport.refreshThenSignUp()
        let client = TCGClient.default(
            transport: transport,
            credentialsKeychainKey: "credentials-key",
            credentialsStore: credentialsStore
        )

        let result = await client.auth.signUp(
            with: .init(email: "jane@example.com", password: "Password123!", name: "Jane Doe")
        )

        try result.get()
        try await assertAutomaticRefreshRequests(in: transport)
    }

    @Test
    func `Should refresh the token before authenticated requests when the token will expire soon`() async throws {
        let credentialsStore = try CredentialsStoreSpy(
            initialData: JSONEncoder().encode(
                makeCredentials(expiryDate: .now.addingTimeInterval(3599))
            )
        )
        let transport = try RequestTransport.refreshThenSignUp()
        let client = TCGClient.default(
            transport: transport,
            credentialsKeychainKey: "credentials-key",
            credentialsStore: credentialsStore
        )

        let result = await client.auth.signUp(
            with: .init(email: "jane@example.com", password: "Password123!", name: "Jane Doe")
        )

        try result.get()
        try await assertAutomaticRefreshRequests(in: transport)
    }

    @Test
    func `Should sign in and store credentials after a successful request`() async throws {
        let credentialsStore = CredentialsStoreSpy()
        let transport = try RequestTransport.signInSuccess()
        let client = TCGClient.default(
            transport: transport,
            credentialsKeychainKey: "credentials-key",
            credentialsStore: credentialsStore
        )

        let result = await client.auth.signIn(
            with: .init(
                email: "jane@example.com",
                password: "Password123!"
            ))

        try result.get()
        try await assertSignInRequest(in: transport)
        let storedCredentials = credentialsStore.storedCredentials
        let credentialsData = try #require(storedCredentials?.data)
        let credentials = try JSONDecoder().decode(Credentials.self, from: credentialsData)
        #expect(storedCredentials?.key == "credentials-key")
        #expect(credentialsStore.deletedKeys == ["credentials-key"])
        #expect(credentials.authToken == "auth-token")
        #expect(credentials.sessionToken == "session-token")
    }

    @Test
    func `Should report unavailable credentials when sign in cannot save them`() async throws {
        let client = TCGClient.default(
            transport: try RequestTransport.signInSuccess(),
            credentialsKeychainKey: "credentials-key",
            credentialsStore: CredentialsStoreSpy(throwsOnSet: true)
        )

        let result = await client.auth.signIn(
            with: .init(
                email: "jane@example.com",
                password: "Password123!"
            ))

        #expect(throws: SignInErrors.credentialsUnavailable(cause: CredentialsStoreError.failed)) {
            try result.get()
        }
    }

    @Test
    func `Should return validation errors from a failed sign in request`() async throws {
        let transport = RequestTransport.validationError()
        let client = TCGClient.default(
            transport: transport,
            credentialsKeychainKey: "credentials-key",
            credentialsStore: CredentialsStoreSpy()
        )

        let result = await client.auth.signIn(
            with: .init(
                email: "jane@example.com",
                password: "Password123!"
            ))

        try #require(
            throws: SignInErrors.badRequest(validations: [
                .init(code: "invalid_format", path: ["email"], message: "Email address is invalid")
            ])
        ) {
            try result.get()
        }

        try await assertSignInRequest(in: transport)
    }

    @Test
    func `Should return empty validation errors from a sign in rejected for invalid credentials`() async throws {
        let transport = RequestTransport.invalidCredentials()
        let credentialsStore = CredentialsStoreSpy()
        let client = TCGClient.default(
            transport: transport,
            credentialsKeychainKey: "credentials-key",
            credentialsStore: credentialsStore
        )

        let result = await client.auth.signIn(
            with: .init(
                email: "jane@example.com",
                password: "Password123!"
            ))

        #expect(throws: SignInErrors.badRequest(validations: [])) {
            try result.get()
        }

        try await assertSignInRequest(in: transport)
        #expect(credentialsStore.deletedKeys == ["credentials-key"])
    }

    @Test
    func
        `Should return a session unavailable error when sign in is unauthorized for a reason other than invalid credentials`()
        async throws
    {
        let transport = RequestTransport.unauthorized()
        let credentialsStore = CredentialsStoreSpy()
        let client = TCGClient.default(
            transport: transport,
            credentialsKeychainKey: "credentials-key",
            credentialsStore: credentialsStore
        )

        let result = await client.auth.signIn(
            with: .init(
                email: "jane@example.com",
                password: "Password123!"
            ))

        #expect(throws: SignInErrors.sessionUnavailable) {
            try result.get()
        }

        try await assertSignInRequest(in: transport)
        #expect(credentialsStore.deletedKeys == ["credentials-key"])
    }

    @Test
    func `Should sign up and store credentials after a successful request`() async throws {
        let credentialsStore = CredentialsStoreSpy()
        let transport = try RequestTransport.signUpSuccess()
        let client = TCGClient.default(
            transport: transport,
            credentialsKeychainKey: "credentials-key",
            credentialsStore: credentialsStore
        )

        let result = await client.auth.signUp(
            with: .init(email: "jane@example.com", password: "Password123!", name: "Jane Doe"))

        try result.get()
        try await assertSignUpRequest(in: transport)
        let storedCredentials = credentialsStore.storedCredentials
        let credentialsData = try #require(storedCredentials?.data)
        let credentials = try JSONDecoder().decode(Credentials.self, from: credentialsData)
        #expect(storedCredentials?.key == "credentials-key")
        #expect(credentials.authToken == "auth-token")
        #expect(credentials.sessionToken == "session-token")
    }

    @Test
    func `Should report unavailable credentials when sign up cannot save them`() async throws {
        let client = TCGClient.default(
            transport: try RequestTransport.signUpSuccess(),
            credentialsKeychainKey: "credentials-key",
            credentialsStore: CredentialsStoreSpy(throwsOnSet: true)
        )

        let result = await client.auth.signUp(
            with: .init(email: "jane@example.com", password: "Password123!", name: "Jane Doe"))

        #expect(throws: SignUpErrors.credentialsUnavailable(cause: CredentialsStoreError.failed)) {
            try result.get()
        }
    }

    @Test
    func `Should return validation errors from a failed sign up request`() async throws {
        let transport = RequestTransport.validationError()
        let client = TCGClient.default(
            transport: transport,
            credentialsKeychainKey: "credentials-key",
            credentialsStore: CredentialsStoreSpy()
        )

        let result = await client.auth.signUp(
            with: .init(email: "jane@example.com", password: "Password123!", name: "Jane Doe"))

        try #require(
            throws: SignUpErrors.badRequest(validations: [
                .init(code: "invalid_format", path: ["email"], message: "Email address is invalid")
            ])
        ) {
            try result.get()
        }

        try await assertSignUpRequest(in: transport)
    }

    @Test
    func `Should return a session unavailable error when sign up receives an unauthorized response`() async throws {
        let transport = RequestTransport.unauthorized()
        let client = TCGClient.default(
            transport: transport,
            credentialsKeychainKey: "credentials-key",
            credentialsStore: CredentialsStoreSpy()
        )

        let result = await client.auth.signUp(
            with: .init(email: "jane@example.com", password: "Password123!", name: "Jane Doe"))

        #expect(throws: SignUpErrors.sessionUnavailable) {
            try result.get()
        }

        try await assertSignUpRequest(in: transport)
    }

    @Test
    func `Should retrieve the current session and update credential expiry`() async throws {
        let initialCredentials = makeCredentials(expiryDate: .distantFuture)
        let credentialsStore = try CredentialsStoreSpy(initialData: JSONEncoder().encode(initialCredentials))
        let transport = RequestTransport.sessionSuccess()
        let client = TCGClient.default(
            transport: transport,
            credentialsKeychainKey: "credentials-key",
            credentialsStore: credentialsStore
        )

        let result = await client.auth.session()

        let session = try result.get()
        let request = try #require(await transport.request)
        let storedCredentials = try #require(credentialsStore.storedCredentials)
        let updatedCredentials = try JSONDecoder().decode(Credentials.self, from: storedCredentials.data)
        let expiresAt = try #require(date("2026-08-12T12:00:00Z"))
        #expect(request.method == .get)
        #expect(request.path == "/app-api/auth/session")
        #expect(request.operationID == "get/app-api/auth/session")
        #expect(request.authorization == "Bearer auth-token")
        #expect(request.body == nil)
        #expect(session.name == "Jane Doe")
        #expect(session.email == "jane@example.com")
        #expect(session.expiresAt == expiresAt)
        #expect(updatedCredentials.sessionExpiryDate == expiresAt)
    }

    @Test
    func `Should return unauthorized without requesting a session when credentials are missing`() async throws {
        let transport = RequestTransport.sessionSuccess()
        let client = TCGClient.default(
            transport: transport,
            credentialsKeychainKey: "credentials-key",
            credentialsStore: CredentialsStoreSpy()
        )

        let result = await client.auth.session()

        #expect(throws: SessionErrors.unauthorized) {
            try result.get()
        }
        #expect(await transport.request == nil)
    }

    @Test
    func `Should delete expired credentials before requesting a session without authorization`() async throws {
        let credentialsStore = try CredentialsStoreSpy(
            initialData: JSONEncoder().encode(
                makeCredentials(expiryDate: .distantPast, sessionExpiryDate: .distantPast)
            )
        )
        let transport = RequestTransport.notFound()
        let client = TCGClient.default(
            transport: transport,
            credentialsKeychainKey: "credentials-key",
            credentialsStore: credentialsStore
        )

        let result = await client.auth.session()

        #expect(throws: SessionErrors.unauthorized) {
            try result.get()
        }
        let request = try #require(await transport.request)
        #expect(credentialsStore.deletedKeys == ["credentials-key", "credentials-key"])
        #expect(request.authorization == nil)
    }

    @Test
    func `Should delete credentials and return unauthorized when the server has no session`() async throws {
        let credentialsStore = try CredentialsStoreSpy(
            initialData: JSONEncoder().encode(makeCredentials(expiryDate: .distantFuture))
        )
        let transport = RequestTransport.notFound()
        let client = TCGClient.default(
            transport: transport,
            credentialsKeychainKey: "credentials-key",
            credentialsStore: credentialsStore
        )

        let result = await client.auth.session()

        #expect(throws: SessionErrors.unauthorized) {
            try result.get()
        }
        #expect(credentialsStore.deletedKeys == ["credentials-key"])
    }

    /// An unreadable keychain is reported as signed out rather than as a server error: the user's recovery is to
    /// sign in again either way, and the underlying failure is logged.
    @Test
    func `Should report signed out when reading credentials fails`() async throws {
        let transport = RequestTransport.sessionSuccess()
        let client = TCGClient.default(
            transport: transport,
            credentialsKeychainKey: "credentials-key",
            credentialsStore: CredentialsStoreSpy(throwsOnGet: true)
        )

        let result = await client.auth.session()

        #expect(throws: SessionErrors.unauthorized) {
            try result.get()
        }
        #expect(await transport.request == nil)
    }

    @Test
    func `Should report signed out when stored credentials cannot be decoded`() async throws {
        let transport = RequestTransport.sessionSuccess()
        let client = TCGClient.default(
            transport: transport,
            credentialsKeychainKey: "credentials-key",
            credentialsStore: CredentialsStoreSpy(initialData: Data("invalid".utf8))
        )

        let result = await client.auth.session()

        #expect(throws: SessionErrors.unauthorized) {
            try result.get()
        }
        #expect(await transport.request == nil)
    }

    /// Caching the session expiry is best effort. The lookup itself succeeded, so a failed cache write must not
    /// fail the call or discard the session.
    @Test
    func `Should still return the session when caching its expiry fails`() async throws {
        let credentialsStore = try CredentialsStoreSpy(
            initialData: JSONEncoder().encode(makeCredentials(expiryDate: .distantFuture)),
            throwsOnSet: true
        )
        let client = TCGClient.default(
            transport: RequestTransport.sessionSuccess(),
            credentialsKeychainKey: "credentials-key",
            credentialsStore: credentialsStore
        )

        let session = try (await client.auth.session()).get()

        #expect(session.email == "jane@example.com")
        #expect(credentialsStore.deletedKeys.isEmpty)
    }

    /// Clearing expired credentials is cleanup. If it fails the request still goes out unauthenticated, which the
    /// server answers with a 401 rather than the client inventing an error.
    @Test
    func `Should proceed unauthenticated when clearing expired credentials fails`() async throws {
        let credentialsStore = try CredentialsStoreSpy(
            initialData: JSONEncoder().encode(makeCredentials(expiryDate: .distantPast)),
            throwsOnDelete: true
        )
        let client = TCGClient.default(
            transport: RequestTransport.sessionSuccess(),
            credentialsKeychainKey: "credentials-key",
            credentialsStore: credentialsStore
        )

        let session = try (await client.auth.session()).get()

        #expect(session.email == "jane@example.com")
    }

    @Test
    func `Should include stored authorization on non-session requests`() async throws {
        let credentialsStore = try CredentialsStoreSpy(
            initialData: JSONEncoder().encode(makeCredentials(expiryDate: .distantFuture))
        )
        let transport = try RequestTransport.signUpSuccess()
        let client = TCGClient.default(
            transport: transport,
            credentialsKeychainKey: "credentials-key",
            credentialsStore: credentialsStore
        )

        let result = await client.auth.signUp(
            with: .init(email: "jane@example.com", password: "Password123!", name: "Jane Doe"))

        try result.get()
        let request = try #require(await transport.request)
        #expect(request.authorization == "Bearer auth-token")
    }

    @Test
    func `Should return an unknown error when session transport fails`() async throws {
        let credentialsStore = try CredentialsStoreSpy(
            initialData: JSONEncoder().encode(makeCredentials(expiryDate: .distantFuture))
        )
        let client = TCGClient.default(
            transport: RequestTransport.failing(),
            credentialsKeychainKey: "credentials-key",
            credentialsStore: credentialsStore
        )

        let result = await client.auth.session()

        #expect(throws: SessionErrors.unknown(status: 503, payload: nil, cause: nil)) {
            try result.get()
        }
    }

    @Test
    func `Should preserve undocumented session response statuses`() async throws {
        let credentialsStore = try CredentialsStoreSpy(
            initialData: JSONEncoder().encode(makeCredentials(expiryDate: .distantFuture))
        )
        let client = TCGClient.default(
            transport: RequestTransport.undocumented(),
            credentialsKeychainKey: "credentials-key",
            credentialsStore: credentialsStore
        )

        let result = await client.auth.session()

        #expect(throws: SessionErrors.unknown(status: 502, payload: nil, cause: nil)) {
            try result.get()
        }
    }

    @Test
    func `Should send the session token as the bearer when refreshing the authentication token`() async throws {
        let credentialsStore = try CredentialsStoreSpy(
            initialData: JSONEncoder().encode(makeCredentials(expiryDate: .distantFuture))
        )
        let transport = try RequestTransport.serverLike()
        let client = TCGClient.default(
            transport: transport,
            credentialsKeychainKey: "credentials-key",
            credentialsStore: credentialsStore
        )

        try await client.auth.refreshToken().get()

        let request = try #require(await transport.request)
        #expect(request.authorization == "Bearer session-token")
    }

    @Test
    func `Should stay signed in when the session update age has elapsed`() async throws {
        let credentialsStore = try CredentialsStoreSpy(
            initialData: JSONEncoder().encode(
                makeCredentials(
                    expiryDate: .now.addingTimeInterval(6 * 24 * 60 * 60),
                    sessionUpdateAge: 24 * 60 * 60,
                    lastSessionUpdate: .now.addingTimeInterval(-25 * 60 * 60)
                ))
        )
        let transport = try RequestTransport.serverLike()
        let client = TCGClient.default(
            transport: transport,
            credentialsKeychainKey: "credentials-key",
            credentialsStore: credentialsStore
        )

        let session = try await client.auth.session().get()

        #expect(session.email == "jane@example.com")
        #expect(credentialsStore.deletedKeys.isEmpty)
        let storedCredentials = try #require(credentialsStore.storedCredentialsData)
        let credentials = try JSONDecoder().decode(Credentials.self, from: storedCredentials)
        #expect(credentials.authToken == "refreshed-auth-token")
    }

    @Test
    func `Should refresh an expired authentication token while the session remains live`() async throws {
        let credentialsStore = try CredentialsStoreSpy(
            initialData: JSONEncoder().encode(
                makeCredentials(expiryDate: .distantPast, sessionExpiryDate: .distantFuture)
            )
        )
        let transport = try RequestTransport.serverLike()
        let client = TCGClient.default(
            transport: transport,
            credentialsKeychainKey: "credentials-key",
            credentialsStore: credentialsStore
        )

        _ = try await client.auth.session().get()

        #expect(credentialsStore.deletedKeys.isEmpty)
        let storedCredentials = try #require(credentialsStore.storedCredentialsData)
        let credentials = try JSONDecoder().decode(Credentials.self, from: storedCredentials)
        #expect(credentials.authToken == "refreshed-auth-token")
    }

    private func makeCredentials(
        expiryDate: Date,
        sessionUpdateAge: TimeInterval = 1800,
        lastSessionUpdate: Date = .now,
        sessionExpiryDate: Date? = nil
    ) -> Credentials {
        Credentials(
            authToken: "auth-token",
            authTokenExpiryDate: expiryDate,
            sessionToken: "session-token",
            sessionUpdateAge: sessionUpdateAge,
            lastSessionUpdate: lastSessionUpdate,
            sessionExpiryDate: sessionExpiryDate,
        )
    }

    private func date(_ value: String) -> Date? {
        ISO8601DateFormatter().date(from: value)
    }

    private func assertSignUpRequest(in transport: RequestTransport) async throws {
        let recordedRequest = await transport.request
        let request = try #require(recordedRequest)
        #expect(request.method == .post)
        #expect(request.path == "/app-api/auth/sign-up/email")
        #expect(request.operationID == "post/app-api/auth/sign-up/email")
        let requestBody = try #require(request.body)
        let signUpPayload = try JSONDecoder().decode(SentSignUpBody.self, from: requestBody)
        #expect(signUpPayload == .init(email: "jane@example.com", password: "Password123!", name: "Jane Doe"))
    }

    private func assertSignInRequest(in transport: RequestTransport) async throws {
        let recordedRequest = await transport.request
        let request = try #require(recordedRequest)
        #expect(request.method == .post)
        #expect(request.path == "/app-api/auth/sign-in/email")
        #expect(request.operationID == "post/app-api/auth/sign-in/email")
        let requestBody = try #require(request.body)
        let signInPayload = try JSONDecoder().decode(SentSignInBody.self, from: requestBody)
        #expect(signInPayload == .init(email: "jane@example.com", password: "Password123!"))
    }

    private func assertRefreshTokenRequest(in transport: RequestTransport) async throws {
        let recordedRequest = await transport.request
        let request = try #require(recordedRequest)
        #expect(request.method == .get)
        #expect(request.path == "/app-api/auth/token")
        #expect(request.operationID == "get/app-api/auth/token")
        #expect(request.authorization == "Bearer session-token")
        #expect(request.body == nil)
    }

    private func assertAutomaticRefreshRequests(in transport: RequestTransport) async throws {
        let requests = await transport.requests
        let refreshRequest = try #require(requests.first)
        let signUpRequest = try #require(requests.last)
        #expect(requests.count == 2)
        #expect(refreshRequest.method == .get)
        #expect(refreshRequest.path == "/app-api/auth/token")
        #expect(refreshRequest.operationID == "get/app-api/auth/token")
        #expect(refreshRequest.authorization == "Bearer session-token")
        #expect(refreshRequest.body == nil)
        #expect(signUpRequest.method == .post)
        #expect(signUpRequest.path == "/app-api/auth/sign-up/email")
        #expect(signUpRequest.operationID == "post/app-api/auth/sign-up/email")
        #expect(signUpRequest.authorization == "Bearer refreshed-auth-token")
    }
}

private actor RequestTransport: ClientTransport {
    private(set) var requests: [RecordedRequest] = []
    private let response: HTTPResponse?
    private let responseBody: Data?
    private let tokenRefreshResponse: HTTPResponse?
    private let tokenRefreshResponseBody: Data?
    private let isServerLike: Bool

    private init(
        response: HTTPResponse?,
        responseBody: Data?,
        tokenRefreshResponse: HTTPResponse? = nil,
        tokenRefreshResponseBody: Data? = nil,
        isServerLike: Bool = false
    ) {
        self.response = response
        self.responseBody = responseBody
        self.tokenRefreshResponse = tokenRefreshResponse
        self.tokenRefreshResponseBody = tokenRefreshResponseBody
        self.isServerLike = isServerLike
    }

    var request: RecordedRequest? {
        requests.last
    }

    static func signInSuccess() throws -> RequestTransport {
        try authSuccess(status: .ok)
    }

    static func signUpSuccess() throws -> RequestTransport {
        try authSuccess(status: .created)
    }

    static func tokenSuccess() throws -> RequestTransport {
        try authSuccess(status: .ok)
    }

    static func refreshThenSignUp() throws -> RequestTransport {
        let tokenResponse = try authSuccessResponse(status: .ok, token: "refreshed-auth-token")
        let signUpResponse = try authSuccessResponse(status: .created)

        return RequestTransport(
            response: signUpResponse.response,
            responseBody: signUpResponse.body,
            tokenRefreshResponse: tokenResponse.response,
            tokenRefreshResponseBody: tokenResponse.body
        )
    }

    static func serverLike() throws -> RequestTransport {
        let tokenResponse = try authSuccessResponse(status: .ok, token: "refreshed-auth-token")
        let sessionResponse = sessionSuccessResponse()

        return RequestTransport(
            response: sessionResponse.response,
            responseBody: sessionResponse.body,
            tokenRefreshResponse: tokenResponse.response,
            tokenRefreshResponseBody: tokenResponse.body,
            isServerLike: true
        )
    }

    private static func authSuccess(status: HTTPResponse.Status) throws -> RequestTransport {
        let response = try authSuccessResponse(status: status)

        return RequestTransport(response: response.response, responseBody: response.body)
    }

    private static func authSuccessResponse(
        status: HTTPResponse.Status,
        token: String = "auth-token"
    ) throws -> (response: HTTPResponse, body: Data) {
        let authTokenHeader = try #require(HTTPField.Name("set-auth-token"))
        let authTokenExpiryHeader = try #require(HTTPField.Name("set-auth-token-expiry"))
        let sessionTokenHeader = try #require(HTTPField.Name("set-session-token"))
        let sessionUpdateAgeHeader = try #require(HTTPField.Name("set-session-update-age"))

        return (
            response: .init(
                status: status,
                headerFields: [
                    .contentType: "application/json",
                    authTokenHeader: token,
                    authTokenExpiryHeader: "3600",
                    sessionTokenHeader: "session-token",
                    sessionUpdateAgeHeader: "1800",
                ]),
            body: Data(
                """
                {
                  "token": "\(token)",
                  "user": {
                    "id": "user-id",
                    "created_at": "2026-07-12T12:00:00.000Z",
                    "email": "jane@example.com",
                    "email_verified": false,
                    "name": "Jane Doe"
                  }
                }
                """.utf8)
        )
    }

    static func validationError() -> RequestTransport {
        RequestTransport(
            response: .init(status: .badRequest, headerFields: [.contentType: "application/json"]),
            responseBody: Data(
                """
                {
                  "message": "Invalid request",
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

    static func unauthorized() -> RequestTransport {
        RequestTransport(
            response: .init(status: .unauthorized, headerFields: [.contentType: "application/json"]),
            responseBody: Data(
                """
                {
                  "message": "Authentication failed"
                }
                """.utf8)
        )
    }

    static func invalidCredentials() -> RequestTransport {
        RequestTransport(
            response: .init(status: .unauthorized, headerFields: [.contentType: "application/json"]),
            responseBody: Data(
                """
                {
                  "message": "Invalid email or password",
                  "code": "INVALID_EMAIL_OR_PASSWORD"
                }
                """.utf8)
        )
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
            .init(
                method: request.method,
                path: request.path,
                operationID: operationID,
                body: requestBody,
                authorization: request.headerFields[.authorization]
            )
        )

        if operationID == "get/app-api/auth/token" {
            if isServerLike, request.headerFields[.authorization] != "Bearer session-token" {
                return Self.notFoundResponse
            }
            if let tokenRefreshResponse {
                return (tokenRefreshResponse, tokenRefreshResponseBody.map(HTTPBody.init))
            }
        }

        guard let response else { throw CredentialsStoreError.failed }

        return (response, responseBody.map(HTTPBody.init))
    }

    static func sessionSuccess() -> RequestTransport {
        let response = sessionSuccessResponse()
        return RequestTransport(response: response.response, responseBody: response.body)
    }

    private static func sessionSuccessResponse() -> (response: HTTPResponse, body: Data) {
        (
            response: .init(status: .ok, headerFields: [.contentType: "application/json"]),
            body: Data(
                """
                {
                  "session": {
                    "expires_at": "2026-08-12T12:00:00.000Z",
                    "created_at": "2026-07-12T12:00:00.000Z",
                    "updated_at": "2026-07-12T12:00:00.000Z"
                  },
                  "user": {
                    "id": "user-id",
                    "created_at": "2026-07-07T10:30:00.000Z",
                    "email": "jane@example.com",
                    "email_verified": false,
                    "name": "Jane Doe"
                  }
                }
                """.utf8)
        )
    }

    static func notFound() -> RequestTransport {
        RequestTransport(
            response: .init(status: .unauthorized, headerFields: [.contentType: "application/json"]),
            responseBody: Data(
                """
                {
                  "message": "Unauthorized",
                  "code": "SESSION_NOT_FOUND"
                }
                """.utf8)
        )
    }

    private static var notFoundResponse: (HTTPResponse, HTTPBody?) {
        (
            .init(status: .unauthorized, headerFields: [.contentType: "application/json"]),
            HTTPBody(
                Data(
                    """
                    {
                      "message": "Unauthorized",
                      "code": "SESSION_NOT_FOUND"
                    }
                    """.utf8))
        )
    }

    static func failing() -> RequestTransport {
        RequestTransport(response: nil, responseBody: nil)
    }

    static func undocumented() -> RequestTransport {
        RequestTransport(
            response: .init(status: .init(code: 502), headerFields: [.contentType: "application/json"]),
            responseBody: Data("{}".utf8)
        )
    }
}

private struct RecordedRequest: Sendable {
    let method: HTTPRequest.Method
    let path: String?
    let operationID: String
    let body: Data?
    let authorization: String?
}

private final class CredentialsStoreSpy: CredentialsStore, @unchecked Sendable {
    private let lock = NSLock()
    private var _storedCredentials: StoredCredentials?
    private var _deletedKeys: [String] = []

    private let throwsOnDelete: Bool
    private let throwsOnGet: Bool
    private let throwsOnSet: Bool

    init(
        initialData: Data? = nil,
        throwsOnDelete: Bool = false,
        throwsOnGet: Bool = false,
        throwsOnSet: Bool = false
    ) {
        if let initialData {
            _storedCredentials = .init(data: initialData, key: "credentials-key")
        }
        self.throwsOnDelete = throwsOnDelete
        self.throwsOnGet = throwsOnGet
        self.throwsOnSet = throwsOnSet
    }

    var storedCredentials: StoredCredentials? {
        lock.lock()
        defer { lock.unlock() }

        return _storedCredentials
    }

    var deletedKeys: [String] {
        lock.lock()
        defer { lock.unlock() }

        return _deletedKeys
    }

    func delete(forKey key: String) throws {
        lock.lock()
        defer { lock.unlock() }

        _deletedKeys.append(key)
        if throwsOnDelete {
            throw CredentialsStoreError.failed
        }

        _storedCredentials = nil
    }

    func get(forKey _: String) throws -> Data? {
        lock.lock()
        defer { lock.unlock() }

        if throwsOnGet {
            throw CredentialsStoreError.failed
        }

        return _storedCredentials?.data
    }

    func set(_ data: Data, forKey key: String) throws {
        lock.lock()
        defer { lock.unlock() }

        if throwsOnSet {
            throw CredentialsStoreError.failed
        }

        _storedCredentials = .init(data: data, key: key)
    }

    var storedCredentialsData: Data? {
        storedCredentials?.data
    }
}

private struct StoredCredentials: Sendable {
    let data: Data
    let key: String
}

private enum CredentialsStoreError: Error {
    case failed
}

/// What the generated client actually puts on the wire.
///
/// Mirrored here rather than decoding `SignUpPayload`, which is an input type for the shared auth client and not a
/// wire format.
private struct SentSignUpBody: Decodable, Equatable {
    let email: String
    let password: String
    let name: String
}

private struct SentSignInBody: Decodable, Equatable {
    let email: String
    let password: String
}
