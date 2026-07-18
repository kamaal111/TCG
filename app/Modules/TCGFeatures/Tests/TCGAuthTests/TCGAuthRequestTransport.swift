//
//  TCGAuthRequestTransport.swift
//  TCGFeatures
//
//  Created by Codex on 7/16/26.
//

import Foundation
import HTTPTypes
import OpenAPIRuntime

actor RequestTransport: ClientTransport {
    private(set) var requests: [RecordedRequest] = []
    private var responses: [StubResponse]
    private let gate: RequestGate?

    private init(responses: [StubResponse], gate: RequestGate? = nil) {
        self.responses = responses
        self.gate = gate
    }

    func send(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL _: URL,
        operationID: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        let requestBody: Data?
        if let body {
            requestBody = try await Data(collecting: body, upTo: .max)
        } else {
            requestBody = nil
        }
        requests.append(.init(method: request.method, path: request.path, operationID: operationID, body: requestBody))

        if let gate {
            await gate.wait()
        }

        guard !responses.isEmpty else { throw RequestTransportError.failed }
        let response = responses.removeFirst()

        return (response.response, response.body.map(HTTPBody.init))
    }

    static func sessionSuccess() -> RequestTransport {
        RequestTransport(responses: [sessionSuccessResponse()])
    }

    static func authenticationSuccess(status: HTTPResponse.Status) throws -> RequestTransport {
        RequestTransport(responses: [try authenticationSuccessResponse(status: status), sessionSuccessResponse()])
    }

    static func authenticationWithMissingSession(status: HTTPResponse.Status) throws -> RequestTransport {
        RequestTransport(responses: [try authenticationSuccessResponse(status: status), notFoundResponse()])
    }

    static func validationError() -> RequestTransport {
        RequestTransport(
            responses: [
                StubResponse(
                    response: .init(status: .badRequest, headerFields: [.contentType: "application/json"]),
                    body: Data(
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
                        """.utf8
                    )
                )
            ]
        )
    }

    static func unauthorized(gate: RequestGate? = nil) -> RequestTransport {
        RequestTransport(
            responses: [
                StubResponse(
                    response: .init(status: .unauthorized, headerFields: [.contentType: "application/json"]),
                    body: Data("{ \"message\": \"Authentication failed\" }".utf8)
                )
            ],
            gate: gate
        )
    }

    static func invalidCredentials() -> RequestTransport {
        RequestTransport(
            responses: [
                StubResponse(
                    response: .init(status: .unauthorized, headerFields: [.contentType: "application/json"]),
                    body: Data(
                        "{ \"message\": \"Invalid email or password\", \"code\": \"INVALID_EMAIL_OR_PASSWORD\" }".utf8
                    )
                )
            ]
        )
    }

    static func conflict() -> RequestTransport {
        RequestTransport(
            responses: [
                StubResponse(
                    response: .init(status: .conflict, headerFields: [.contentType: "application/json"]),
                    body: Data("{ \"message\": \"Account exists\" }".utf8)
                )
            ]
        )
    }

    static func failing() -> RequestTransport {
        RequestTransport(responses: [])
    }

    private static func authenticationSuccessResponse(status: HTTPResponse.Status) throws -> StubResponse {
        guard let authToken = HTTPField.Name("set-auth-token") else { throw RequestTransportError.failed }
        guard let authTokenExpiry = HTTPField.Name("set-auth-token-expiry") else { throw RequestTransportError.failed }
        guard let sessionToken = HTTPField.Name("set-session-token") else { throw RequestTransportError.failed }
        guard let sessionUpdateAge = HTTPField.Name("set-session-update-age") else {
            throw RequestTransportError.failed
        }

        return StubResponse(
            response: .init(
                status: status,
                headerFields: [
                    .contentType: "application/json",
                    authToken: "auth-token",
                    authTokenExpiry: "86400",
                    sessionToken: "session-token",
                    sessionUpdateAge: "1800",
                ]
            ),
            body: Data(
                """
                {
                  "token": "auth-token",
                  "user": {
                    "id": "user-id",
                    "created_at": "2026-07-12T12:00:00.000Z",
                    "email": "jane@example.com",
                    "email_verified": false,
                    "name": "Jane Doe"
                  }
                }
                """.utf8
            )
        )
    }

    private static func sessionSuccessResponse() -> StubResponse {
        StubResponse(
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
                    "created_at": "2026-07-12T12:00:00.000Z",
                    "email": "jane@example.com",
                    "email_verified": false,
                    "name": "Jane Doe"
                  }
                }
                """.utf8
            )
        )
    }

    private static func notFoundResponse() -> StubResponse {
        StubResponse(
            response: .init(status: .notFound, headerFields: [.contentType: "application/json"]),
            body: Data(
                """
                {
                  "message": "Not found",
                  "code": "NOT_FOUND"
                }
                """.utf8
            )
        )
    }

    static func notFound() -> RequestTransport {
        RequestTransport(responses: [notFoundResponse()])
    }
}

struct RecordedRequest: Sendable {
    let method: HTTPRequest.Method
    let path: String?
    let operationID: String
    let body: Data?
}

private struct StubResponse: Sendable {
    let response: HTTPResponse
    let body: Data?
}

actor RequestGate {
    private var continuation: CheckedContinuation<Void, Never>?
    private var isReleased = false

    func wait() async {
        guard !isReleased else { return }
        await withCheckedContinuation { continuation in
            self.continuation = continuation
        }
    }

    func release() {
        isReleased = true
        continuation?.resume()
        continuation = nil
    }
}

private enum RequestTransportError: Error {
    case failed
}
