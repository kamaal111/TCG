//
//  TCGAuthRequestHooks.swift
//  TCGClient
//

import Foundation
import KamaalAuth
import KamaalLogger
import OpenAPIRuntime

private let logger = KamaalLogger(from: TCGAuthRequestHooks.self)

/// Performs the auth requests on `KamaalAuthClient`'s behalf, using this module's generated OpenAPI client.
///
/// The generated `Client` is `internal` to `TCGClient`, so this is the only place that can reach it — which is
/// exactly the seam the package's hook contract expects. Everything worth sharing (credential storage, the refresh
/// policy, expiry rules, error semantics) stays in the package.
struct TCGAuthRequestHooks: AuthRequestHooks {
    /// Carries the authorization middleware, so the session lookup is signed.
    let client: Client
    /// Carries only the session-token middleware, so minting a token cannot recurse into a refresh.
    let tokenClient: Client

    func signUp(_ payload: SignUpPayload) async -> AuthRequestOutcome<AuthCredentialHeaders> {
        let response: Operations.PostAppApiAuthSignUpEmail.Output
        do {
            response = try await client.postAppApiAuthSignUpEmail(
                body: .json(.init(email: payload.email, password: payload.password, name: payload.name))
            )
        } catch {
            return .failure(unreachable(operation: "Account creation", error: error))
        }

        switch response {
        case .created(let created): return AuthTokenHeadersMapper.credentials(from: created.headers)
        case .badRequest(let badRequest): return .failure(failure(status: 400, body: try? badRequest.body.json))
        case .conflict(let conflict): return .failure(failure(status: 409, body: try? conflict.body.json))
        case .unauthorized(let unauthorized): return .failure(failure(status: 401, body: try? unauthorized.body.json))
        case .undocumented(let statusCode, _): return .failure(AuthRequestFailure(status: statusCode))
        }
    }

    func signIn(_ payload: SignInPayload) async -> AuthRequestOutcome<AuthCredentialHeaders> {
        let response: Operations.PostAppApiAuthSignInEmail.Output
        do {
            response = try await client.postAppApiAuthSignInEmail(
                body: .json(.init(email: payload.email, password: payload.password))
            )
        } catch {
            return .failure(unreachable(operation: "Sign in", error: error))
        }

        switch response {
        case .ok(let ok): return AuthTokenHeadersMapper.credentials(from: ok.headers)
        case .badRequest(let badRequest): return .failure(failure(status: 400, body: try? badRequest.body.json))
        case .unauthorized(let unauthorized): return .failure(failure(status: 401, body: try? unauthorized.body.json))
        case .undocumented(let statusCode, _): return .failure(AuthRequestFailure(status: statusCode))
        }
    }

    func signOut() async -> AuthRequestOutcome<Void> {
        let response: Operations.PostAppApiAuthSignOut.Output
        do {
            response = try await client.postAppApiAuthSignOut()
        } catch {
            return .failure(unreachable(operation: "Sign out", error: error))
        }

        switch response {
        case .ok: return .success(())
        case .unauthorized(let unauthorized): return .failure(failure(status: 401, body: try? unauthorized.body.json))
        case .undocumented(let statusCode, _): return .failure(AuthRequestFailure(status: statusCode))
        }
    }

    func session() async -> AuthRequestOutcome<AuthSession> {
        let response: Operations.GetAppApiAuthSession.Output
        do {
            response = try await client.getAppApiAuthSession()
        } catch {
            return .failure(unreachable(operation: "Session", error: error))
        }

        switch response {
        case .ok(let ok):
            let payload: Components.Schemas.SessionResponse
            do {
                payload = try ok.body.json
            } catch {
                return .failure(AuthRequestFailure(status: 503, cause: error))
            }

            return .success(
                AuthSession(
                    id: payload.user.id,
                    name: payload.user.name,
                    email: payload.user.email,
                    emailVerified: payload.user.emailVerified,
                    createdAt: payload.user.createdAt,
                    expiresAt: payload.session.expiresAt,
                )
            )
        case .unauthorized(let unauthorized): return .failure(failure(status: 401, body: try? unauthorized.body.json))
        case .undocumented(let statusCode, _): return .failure(AuthRequestFailure(status: statusCode))
        }
    }

    func issueToken() async -> AuthRequestOutcome<AuthCredentialHeaders> {
        await AuthTokenIssuer.issue(using: tokenClient)
    }

    private func failure(status: Int, body: (some Encodable)?) -> AuthRequestFailure {
        AuthErrorBody.failure(status: status, body: body.flatMap { try? JSONEncoder().encode($0) })
    }

    private func unreachable(operation: String, error: any Error) -> AuthRequestFailure {
        if let clientError = error as? ClientError, let response = clientError.response {
            logger.error("\(operation) response could not be decoded (status \(response.status.code)).")
        } else {
            logger.error("\(operation) request failed before receiving a server response.")
        }

        return AuthRequestFailure.unreachable(error)
    }
}
