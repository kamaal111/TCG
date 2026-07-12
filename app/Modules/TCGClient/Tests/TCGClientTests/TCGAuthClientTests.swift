//
//  TCGAuthClientTests.swift
//  TCGClient
//
//  Created by Kamaal M Farah on 7/11/26.
//

import Foundation
import HTTPTypes
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
        let storedCredentials = try #require(await credentialsStore.storedCredentials)
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

        try #require(throws: SessionErrors.unauthorized) {
            try result.get()
        }
        try await assertRefreshTokenRequest(in: transport)
        #expect(await credentialsStore.deletedKeys == ["credentials-key"])
        #expect(await credentialsStore.storedCredentialsData == nil)
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

        try #require(throws: SessionErrors.unknown(status: 503, payload: nil, cause: nil)) {
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

        try #require(throws: SessionErrors.unknown(status: 502, payload: nil, cause: nil)) {
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
            with: .init(name: "Jane Doe", email: "jane@example.com", password: "Password123!")
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
            with: .init(name: "Jane Doe", email: "jane@example.com", password: "Password123!")
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
        let storedCredentials = await credentialsStore.storedCredentials
        let credentialsData = try #require(storedCredentials?.data)
        let credentials = try JSONDecoder().decode(Credentials.self, from: credentialsData)
        #expect(storedCredentials?.key == "credentials-key")
        #expect(await credentialsStore.deletedKeys == ["credentials-key"])
        #expect(credentials.authToken == "auth-token")
        #expect(credentials.sessionToken == "session-token")
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
    func `Should return empty validation errors from an unauthorized sign in request`() async throws {
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

        try #require(throws: SignInErrors.badRequest(validations: [])) {
            try result.get()
        }

        try await assertSignInRequest(in: transport)
        #expect(await credentialsStore.deletedKeys == ["credentials-key"])
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
            with: .init(
                name: "Jane Doe",
                email: "jane@example.com",
                password: "Password123!"
            ))

        try result.get()
        try await assertSignUpRequest(in: transport)
        let storedCredentials = await credentialsStore.storedCredentials
        let credentialsData = try #require(storedCredentials?.data)
        let credentials = try JSONDecoder().decode(Credentials.self, from: credentialsData)
        #expect(storedCredentials?.key == "credentials-key")
        #expect(credentials.authToken == "auth-token")
        #expect(credentials.sessionToken == "session-token")
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
            with: .init(
                name: "Jane Doe",
                email: "jane@example.com",
                password: "Password123!"
            ))

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
        let storedCredentials = try #require(await credentialsStore.storedCredentials)
        let updatedCredentials = try JSONDecoder().decode(Credentials.self, from: storedCredentials.data)
        let expiresAt = try #require(date("2026-08-12T12:00:00Z"))
        #expect(request.method == .get)
        #expect(request.path == "/app-api/auth/session")
        #expect(request.operationID == "get/app-api/auth/session")
        #expect(request.authorization == "Bearer auth-token")
        #expect(request.body == nil)
        #expect(
            session
                == .init(
                    name: "Jane Doe",
                    email: "jane@example.com",
                    expiresAt: expiresAt
                ))
        #expect(updatedCredentials.expiryDate == expiresAt)
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

        try #require(throws: SessionErrors.unauthorized) {
            try result.get()
        }
        #expect(await transport.request == nil)
    }

    @Test
    func `Should delete expired credentials before requesting a session without authorization`() async throws {
        let credentialsStore = try CredentialsStoreSpy(
            initialData: JSONEncoder().encode(makeCredentials(expiryDate: .distantPast))
        )
        let transport = RequestTransport.notFound()
        let client = TCGClient.default(
            transport: transport,
            credentialsKeychainKey: "credentials-key",
            credentialsStore: credentialsStore
        )

        let result = await client.auth.session()

        try #require(throws: SessionErrors.unauthorized) {
            try result.get()
        }
        let request = try #require(await transport.request)
        #expect(await credentialsStore.deletedKeys == ["credentials-key", "credentials-key"])
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

        try #require(throws: SessionErrors.unauthorized) {
            try result.get()
        }
        #expect(await credentialsStore.deletedKeys == ["credentials-key"])
    }

    @Test
    func `Should return an unknown error when reading credentials fails`() async throws {
        let transport = RequestTransport.sessionSuccess()
        let client = TCGClient.default(
            transport: transport,
            credentialsKeychainKey: "credentials-key",
            credentialsStore: CredentialsStoreSpy(throwsOnGet: true)
        )

        let result = await client.auth.session()

        try #require(throws: SessionErrors.unknown(status: 500, payload: nil, cause: nil)) {
            try result.get()
        }
        #expect(await transport.request == nil)
    }

    @Test
    func `Should return an unknown error when stored credentials cannot be decoded`() async throws {
        let transport = RequestTransport.sessionSuccess()
        let client = TCGClient.default(
            transport: transport,
            credentialsKeychainKey: "credentials-key",
            credentialsStore: CredentialsStoreSpy(initialData: Data("invalid".utf8))
        )

        let result = await client.auth.session()

        try #require(throws: SessionErrors.unknown(status: 500, payload: nil, cause: nil)) {
            try result.get()
        }
        #expect(await transport.request == nil)
    }

    @Test
    func `Should return an unknown error when updating session credentials fails`() async throws {
        let credentialsStore = try CredentialsStoreSpy(
            initialData: JSONEncoder().encode(makeCredentials(expiryDate: .distantFuture)),
            throwsOnSet: true
        )
        let client = TCGClient.default(
            transport: RequestTransport.sessionSuccess(),
            credentialsKeychainKey: "credentials-key",
            credentialsStore: credentialsStore
        )

        let result = await client.auth.session()

        try #require(throws: SessionErrors.unknown(status: 500, payload: nil, cause: nil)) {
            try result.get()
        }
        #expect(await credentialsStore.deletedKeys == ["credentials-key"])
        #expect(await credentialsStore.storedCredentialsData == nil)
    }

    @Test
    func `Should return an unknown error when deleting expired credentials in middleware fails`() async throws {
        let credentialsStore = try CredentialsStoreSpy(
            initialData: JSONEncoder().encode(makeCredentials(expiryDate: .distantPast)),
            throwsOnDelete: true
        )
        let client = TCGClient.default(
            transport: RequestTransport.sessionSuccess(),
            credentialsKeychainKey: "credentials-key",
            credentialsStore: credentialsStore
        )

        let result = await client.auth.session()

        try #require(throws: SessionErrors.unknown(status: 503, payload: nil, cause: nil)) {
            try result.get()
        }
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
            with: .init(
                name: "Jane Doe",
                email: "jane@example.com",
                password: "Password123!"
            ))

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

        try #require(throws: SessionErrors.unknown(status: 503, payload: nil, cause: nil)) {
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

        try #require(throws: SessionErrors.unknown(status: 502, payload: nil, cause: nil)) {
            try result.get()
        }
    }

    private func makeCredentials(
        expiryDate: Date,
        sessionUpdateAge: TimeInterval = 1800,
        lastSessionUpdate: Date = .now
    ) -> Credentials {
        Credentials(
            authToken: "auth-token",
            expiryDate: expiryDate,
            sessionToken: "session-token",
            sessionUpdateAge: sessionUpdateAge,
            lastSessionUpdate: lastSessionUpdate,
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
        let signUpPayload = try JSONDecoder().decode(SignUpPayload.self, from: requestBody)
        #expect(
            signUpPayload
                == .init(
                    name: "Jane Doe",
                    email: "jane@example.com",
                    password: "Password123!"
                ))
    }

    private func assertSignInRequest(in transport: RequestTransport) async throws {
        let recordedRequest = await transport.request
        let request = try #require(recordedRequest)
        #expect(request.method == .post)
        #expect(request.path == "/app-api/auth/sign-in/email")
        #expect(request.operationID == "post/app-api/auth/sign-in/email")
        let requestBody = try #require(request.body)
        let signInPayload = try JSONDecoder().decode(SignInPayload.self, from: requestBody)
        #expect(
            signInPayload
                == .init(
                    email: "jane@example.com",
                    password: "Password123!"
                ))
    }

    private func assertRefreshTokenRequest(in transport: RequestTransport) async throws {
        let recordedRequest = await transport.request
        let request = try #require(recordedRequest)
        #expect(request.method == .get)
        #expect(request.path == "/app-api/auth/token")
        #expect(request.operationID == "get/app-api/auth/token")
        #expect(request.authorization == "Bearer auth-token")
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
        #expect(refreshRequest.authorization == "Bearer auth-token")
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

    private init(
        response: HTTPResponse?,
        responseBody: Data?,
        tokenRefreshResponse: HTTPResponse? = nil,
        tokenRefreshResponseBody: Data? = nil
    ) {
        self.response = response
        self.responseBody = responseBody
        self.tokenRefreshResponse = tokenRefreshResponse
        self.tokenRefreshResponseBody = tokenRefreshResponseBody
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
                    "created_at": "2026-07-12T12:00:00Z",
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
            if let tokenRefreshResponse {
                return (tokenRefreshResponse, tokenRefreshResponseBody.map(HTTPBody.init))
            }
        }

        guard let response else { throw CredentialsStoreError.failed }

        return (response, responseBody.map(HTTPBody.init))
    }

    static func sessionSuccess() -> RequestTransport {
        RequestTransport(
            response: .init(status: .ok, headerFields: [.contentType: "application/json"]),
            responseBody: Data(
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

    static func notFound() -> RequestTransport {
        RequestTransport(
            response: .init(status: .notFound, headerFields: [.contentType: "application/json"]),
            responseBody: Data("{ \"message\": \"Not found\", \"code\": \"NOT_FOUND\" }".utf8)
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

private actor CredentialsStoreSpy: CredentialsStore {
    private(set) var storedCredentials: StoredCredentials?
    private(set) var deletedKeys: [String] = []

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
            storedCredentials = .init(data: initialData, key: "credentials-key")
        }
        self.throwsOnDelete = throwsOnDelete
        self.throwsOnGet = throwsOnGet
        self.throwsOnSet = throwsOnSet
    }

    func delete(forKey key: String) async throws {
        deletedKeys.append(key)
        if throwsOnDelete {
            throw CredentialsStoreError.failed
        }

        storedCredentials = nil
    }

    func get(forKey _: String) async throws -> Data? {
        if throwsOnGet {
            throw CredentialsStoreError.failed
        }

        return storedCredentials?.data
    }

    func set(_ data: Data, forKey key: String) async throws {
        if throwsOnSet {
            throw CredentialsStoreError.failed
        }

        storedCredentials = .init(data: data, key: key)
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
