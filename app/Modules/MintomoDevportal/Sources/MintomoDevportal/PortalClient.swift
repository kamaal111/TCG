import Foundation
import OpenAPIRuntime
import OpenAPIURLSession

protocol PortalClient: Sendable {
    func server(page: Int) async -> Result<PortalServer, PortalClientError>

    func start(sha: String, fingerprint: String, requestID: String) async -> Result<PortalRelease, PortalClientError>

    func release(id: String) async -> Result<PortalRelease, PortalClientError>

    func decide(_ decision: PortalApprovalDecision) async -> Result<PortalRelease, PortalClientError>
}

struct PortalClientImpl: PortalClient {
    private let client: Client

    static func connect(url: URL, transport: any ClientTransport = URLSessionTransport()) -> Result<
        Self, PortalClientError
    > {
        guard url.scheme == "https" else { return .failure(.invalidURL) }
        guard let host = url.host() else { return .failure(.invalidURL) }
        guard host.hasSuffix(".ts.net") else { return .failure(.invalidURL) }
        guard url.user == nil else { return .failure(.invalidURL) }
        guard url.password == nil else { return .failure(.invalidURL) }
        guard url.query == nil else { return .failure(.invalidURL) }
        guard url.fragment == nil else { return .failure(.invalidURL) }
        return .success(Self(client: Client(serverURL: url, transport: transport)))
    }

    func server(page: Int) async -> Result<PortalServer, PortalClientError> {
        let output: Operations.getServer.Output
        do {
            output = try await client.getServer(.init(query: .init(page: page)))
        } catch {
            return .failure(.unknown(status: 503, payload: nil, cause: error))
        }

        switch output {
        case .ok(let response):
            do {
                return .success(try response.body.json)
            } catch {
                return .failure(.unknown(status: 503, payload: nil, cause: error))
            }
        case .unauthorized: return .failure(.unauthorized)
        case .forbidden: return .failure(.forbidden)
        case .conflict: return .failure(.conflict)
        case .badRequest, .notFound, .contentTooLarge, .serviceUnavailable: return .failure(.unavailable)
        case .undocumented(let status, let payload):
            return .failure(.unknown(status: status, payload: payload, cause: nil))
        }
    }

    func start(sha: String, fingerprint: String, requestID: String) async -> Result<PortalRelease, PortalClientError> {
        let output: Operations.startRelease.Output
        do {
            output = try await client.startRelease(
                .init(body: .json(.init(sha: sha, fingerprint: fingerprint, requestId: requestID)))
            )
        } catch {
            return .failure(.unknown(status: 503, payload: nil, cause: error))
        }

        switch output {
        case .accepted(let response):
            do {
                return .success(try response.body.json)
            } catch {
                return .failure(.unknown(status: 503, payload: nil, cause: error))
            }
        case .unauthorized: return .failure(.unauthorized)
        case .forbidden: return .failure(.forbidden)
        case .conflict: return .failure(.conflict)
        case .badRequest, .notFound, .contentTooLarge, .serviceUnavailable: return .failure(.unavailable)
        case .undocumented(let status, let payload):
            return .failure(.unknown(status: status, payload: payload, cause: nil))
        }
    }

    func release(id: String) async -> Result<PortalRelease, PortalClientError> {
        let output: Operations.getRelease.Output
        do {
            output = try await client.getRelease(.init(path: .init(id: id)))
        } catch {
            return .failure(.unknown(status: 503, payload: nil, cause: error))
        }

        switch output {
        case .ok(let response):
            do {
                return .success(try response.body.json)
            } catch {
                return .failure(.unknown(status: 503, payload: nil, cause: error))
            }
        case .unauthorized: return .failure(.unauthorized)
        case .forbidden: return .failure(.forbidden)
        case .conflict: return .failure(.conflict)
        case .badRequest, .notFound, .contentTooLarge, .serviceUnavailable: return .failure(.unavailable)
        case .undocumented(let status, let payload):
            return .failure(.unknown(status: status, payload: payload, cause: nil))
        }
    }

    func decide(_ decision: PortalApprovalDecision) async -> Result<PortalRelease, PortalClientError> {
        let output: Operations.answerApproval.Output
        do {
            output = try await client.answerApproval(
                .init(
                    path: .init(id: decision.releaseID, approvalId: decision.approvalID),
                    body: .json(.init(approved: decision.approved, requestId: decision.requestID))
                )
            )
        } catch {
            return .failure(.unknown(status: 503, payload: nil, cause: error))
        }

        switch output {
        case .ok(let response):
            do {
                return .success(try response.body.json)
            } catch {
                return .failure(.unknown(status: 503, payload: nil, cause: error))
            }
        case .unauthorized: return .failure(.unauthorized)
        case .forbidden: return .failure(.forbidden)
        case .conflict: return .failure(.conflict)
        case .badRequest, .notFound, .contentTooLarge, .serviceUnavailable: return .failure(.unavailable)
        case .undocumented(let status, let payload):
            return .failure(.unknown(status: status, payload: payload, cause: nil))
        }
    }

}
