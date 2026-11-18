import Foundation
import HTTPTypes
import KamaalAuth
import OpenAPIRuntime

@testable import TCGCards
@testable import TCGClient

@MainActor
enum CSVImportTestClient {
    static var draft: CSVImportCard {
        let printing = CardsTestIDs.addPrinting
        let rows = CardsCSVFixtures.rows.map { row in
            var row = row
            row[.game] = printing.game.rawValue
            row[.name] = printing.name
            row[.setName] = printing.setName ?? ""
            row[.cardNumber] = printing.cardNumber
            return row
        }
        return .init(id: CardsCSVFixtures.card.id, rows: rows)
    }

    static func readyReview(filename: String, draft: CSVImportCard) async
        -> TCGCardsImportReviewModel
    {
        let model = TCGCardsImportReviewModel(filename: filename, cards: [draft])
        await model.refreshLookups(using: TCGCards(client: .preview(cardsOutcome: .empty)))
        return model
    }

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
    private var catalogPages: [String]
    private(set) var importBody: Data?
    private(set) var catalogPaths: [String] = []

    init(status: HTTPResponse.Status, response: String, fails: Bool, catalogPages: [String]) {
        self.status = status
        self.response = response
        self.fails = fails
        self.catalogPages = catalogPages
    }

    func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws -> (
        HTTPResponse, HTTPBody?
    ) {
        if fails { throw URLError(.notConnectedToInternet) }

        if let path = request.path, path.hasPrefix("/app-api/pricing/search") {
            catalogPaths.append(path)
            if !catalogPages.isEmpty {
                return (
                    HTTPResponse(status: .ok, headerFields: [.contentType: "application/json"]),
                    HTTPBody(catalogPages.removeFirst())
                )
            }
        }
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
