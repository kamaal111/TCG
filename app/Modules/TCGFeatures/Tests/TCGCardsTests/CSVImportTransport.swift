import Foundation
import HTTPTypes
import KamaalAuth
import OpenAPIRuntime

@testable import TCGCards
@testable import TCGClient

@MainActor
enum CSVImportTestClient {
    static func makeCollection(transport: any ClientTransport) throws -> TCGCards {
        let credentials = Credentials(
            authToken: "auth-token",
            authTokenExpiryDate: .distantFuture,
            sessionToken: "session-token",
            sessionUpdateAge: 1800,
            lastSessionUpdate: .now
        )
        return TCGCards(
            client: .default(
                transport: transport,
                credentialsKeychainKey: "csv-import-regressions",
                credentialsStore: InMemoryCredentialsStore(seed: try JSONEncoder().encode(credentials))
            )
        )
    }

}

actor CSVImportTransport: ClientTransport {
    private let status: HTTPResponse.Status
    private let response: String
    private let fails: Bool
    private(set) var importBody: Data?

    init(status: HTTPResponse.Status, response: String, fails: Bool = false) {
        self.status = status
        self.response = response
        self.fails = fails
    }

    func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws -> (
        HTTPResponse, HTTPBody?
    ) {
        if fails { throw URLError(.notConnectedToInternet) }

        if request.method == .post {
            if let body { importBody = try await Data(collecting: body, upTo: 1_000_000) }
            return (HTTPResponse(status: status, headerFields: [.contentType: "application/json"]), HTTPBody(response))
        }
        return (
            HTTPResponse(status: .serviceUnavailable, headerFields: [.contentType: "application/json"]),
            HTTPBody("{\"message\":\"Unavailable\",\"code\":\"UNAVAILABLE\"}")
        )
    }
}
