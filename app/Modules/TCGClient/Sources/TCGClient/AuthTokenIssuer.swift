//
//  AuthTokenIssuer.swift
//  TCGClient
//

import Foundation
import KamaalAuth
import KamaalLogger
import OpenAPIRuntime

private let logger = KamaalLogger(from: AuthTokenIssuer.self)

/// Namespaces the standalone JWT minting helper shared by ``TCGAuthRequestHooks`` and ``TCGClient``.
///
/// Needed before any hooks object exists — a client whose middleware asks the provider for a token cannot also be
/// the client the provider refreshes through — so it can't live as a method on the hooks struct.
enum AuthTokenIssuer {
    /// Mints a fresh JWT.
    ///
    /// - Parameter client: Must carry ``SessionTokenMiddleware``, which authorizes from the stored session token.
    ///   That is why the session token needs no plumbing here.
    static func issue(using client: Client) async -> AuthRequestOutcome<AuthCredentialHeaders> {
        let response: Operations.GetAppApiAuthToken.Output
        do {
            response = try await client.getAppApiAuthToken()
        } catch {
            logger.error("Authentication token refresh request failed before receiving a server response.")

            return .failure(AuthRequestFailure.unreachable(error))
        }

        switch response {
        case .ok(let ok): return AuthTokenHeadersMapper.credentials(from: ok.headers)
        case .unauthorized(let unauthorized):
            return .failure(
                AuthErrorBody.failure(status: 401, body: try? JSONEncoder().encode(unauthorized.body.json))
            )
        case .undocumented(let statusCode, _): return .failure(AuthRequestFailure(status: statusCode))
        }
    }
}
