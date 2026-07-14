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
    private let response: HTTPResponse?
    private let responseBody: Data?

    private init(response: HTTPResponse?, responseBody: Data?) {
        self.response = response
        self.responseBody = responseBody
    }

    func send(
        _ request: HTTPRequest,
        body _: HTTPBody?,
        baseURL _: URL,
        operationID: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        requests.append(.init(method: request.method, path: request.path, operationID: operationID))

        guard let response else { throw RequestTransportError.failed }

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
}

private struct RecordedRequest: Sendable {
    let method: HTTPRequest.Method
    let path: String?
    let operationID: String
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
