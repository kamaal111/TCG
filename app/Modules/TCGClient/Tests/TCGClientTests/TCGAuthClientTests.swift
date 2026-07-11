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
    func `Should sign up and store credentials after a successful request`() async throws {
        let credentialsStore = CredentialsStoreSpy()
        let transport = try SignUpRequestTransport.success()
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
        let transport = SignUpRequestTransport.badRequest()
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

    private func assertSignUpRequest(in transport: SignUpRequestTransport) async throws {
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
}

private actor SignUpRequestTransport: ClientTransport {
    private(set) var request: RecordedRequest?
    private let response: HTTPResponse
    private let responseBody: Data

    private init(response: HTTPResponse, responseBody: Data) {
        self.response = response
        self.responseBody = responseBody
    }

    static func success() throws -> SignUpRequestTransport {
        let authTokenHeader = try #require(HTTPField.Name("set-auth-token"))
        let authTokenExpiryHeader = try #require(HTTPField.Name("set-auth-token-expiry"))
        let sessionTokenHeader = try #require(HTTPField.Name("set-session-token"))
        let sessionUpdateAgeHeader = try #require(HTTPField.Name("set-session-update-age"))

        return SignUpRequestTransport(
            response: .init(
                status: .created,
                headerFields: [
                    .contentType: "application/json",
                    authTokenHeader: "auth-token",
                    authTokenExpiryHeader: "3600",
                    sessionTokenHeader: "session-token",
                    sessionUpdateAgeHeader: "1800",
                ]),
            responseBody: Data(
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

    static func badRequest() -> SignUpRequestTransport {
        SignUpRequestTransport(
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
        self.request = .init(
            method: request.method,
            path: request.path,
            operationID: operationID,
            body: requestBody
        )

        return (response, .init(responseBody))
    }
}

private struct RecordedRequest: Sendable {
    let method: HTTPRequest.Method
    let path: String?
    let operationID: String
    let body: Data?
}

private actor CredentialsStoreSpy: CredentialsStore {
    private(set) var storedCredentials: StoredCredentials?

    func set(_ data: Data, forKey key: String) async throws {
        storedCredentials = .init(data: data, key: key)
    }
}

private struct StoredCredentials: Sendable {
    let data: Data
    let key: String
}
