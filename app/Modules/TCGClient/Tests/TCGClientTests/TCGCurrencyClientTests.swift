import Foundation
import HTTPTypes
import OpenAPIRuntime
import Testing

@testable import TCGClient

@Suite("Currency client transport")
struct TCGCurrencyClientTests {
    @Test
    func `Loads the enriched session through the generated client`() async throws {
        let transport = CurrencyTransport(status: .ok, json: Self.session)
        let client = TCGCurrencyClientImpl(
            client: Client(serverURL: URL(string: "http://localhost:8080")!, transport: transport)
        )
        let preference = try await client.preference().get()
        #expect(preference.currency == .eur)
        #expect(preference.isExplicit)
        #expect(await transport.path == "/app-api/auth/session")
        #expect(await transport.operation == "get/app-api/auth/session")
    }

    @Test
    func `Sends and maps the preferred currency update`() async throws {
        let transport = CurrencyTransport(status: .ok, json: Self.session)
        let client = TCGCurrencyClientImpl(
            client: Client(serverURL: URL(string: "http://localhost:8080")!, transport: transport)
        )
        let preference = try await client.update(.init(preferredCurrency: .eur)).get()
        let body = try #require(await transport.body)
        #expect(try JSONDecoder().decode(UpdateCurrencyPreferencePayload.self, from: body).preferredCurrency == .eur)
        #expect(await transport.method == .patch)
        #expect(await transport.path == "/app-api/auth/preferences")
        #expect(preference.currency == .eur)
    }

    @Test
    func `Loads and validates exchange rates through generated decoding`() async throws {
        let transport = CurrencyTransport(
            status: .ok,
            json: """
                {"base":"EUR","date":"2026-10-16","rates":{"EUR":1,"USD":1.25,"JPY":150}}
                """
        )
        let client = TCGCurrencyClientImpl(
            client: Client(serverURL: URL(string: "http://localhost:8080")!, transport: transport)
        )
        let rates = try await client.latestRates().get()
        #expect(rates.convert(12.5, from: .usd, to: .eur) == 10)
        #expect(await transport.path == "/app-api/forex/latest")
    }

    @Test
    func `Maps missing exchange rates as unavailable`() async throws {
        let transport = CurrencyTransport(
            status: .serviceUnavailable,
            json: """
                {"code":"EXCHANGE_RATES_UNAVAILABLE","message":"No exchange rates available"}
                """
        )
        let client = TCGCurrencyClientImpl(
            client: Client(serverURL: URL(string: "http://localhost:8080")!, transport: transport)
        )
        await #expect(throws: CurrencyClientError.unavailable) { try await client.latestRates().get() }
    }

    @Test
    func `Maps unauthorized preference updates`() async {
        let transport = CurrencyTransport(
            status: .unauthorized,
            json: """
                {"message":"Unauthorized","code":"UNAUTHORIZED"}
                """
        )
        let client = TCGCurrencyClientImpl(
            client: Client(serverURL: URL(string: "http://localhost:8080")!, transport: transport)
        )
        await #expect(throws: CurrencyClientError.unauthorized) {
            try await client.update(.init(preferredCurrency: .eur)).get()
        }
    }

    @Test
    func `Rejects invalid rates without producing a conversion`() async {
        let transport = CurrencyTransport(
            status: .ok,
            json: """
                {"base":"EUR","date":"2026-10-16","rates":{"EUR":1,"USD":0,"JPY":150}}
                """
        )
        let client = TCGCurrencyClientImpl(
            client: Client(serverURL: URL(string: "http://localhost:8080")!, transport: transport)
        )
        await #expect(throws: CurrencyClientError.unknown) { try await client.latestRates().get() }
    }

    private static let session = """
        {"session":{"expires_at":"2030-01-01T00:00:00Z","created_at":"2026-10-16T00:00:00Z","updated_at":"2026-10-16T00:00:00Z"},"user":{"id":"user-1","name":"User","email":"user@example.com","email_verified":false,"created_at":"2026-10-16T00:00:00Z","preferred_currency":"EUR","has_preferred_currency_preference":true}}
        """
}

private actor CurrencyTransport: ClientTransport {
    private(set) var path: String?
    private(set) var method: HTTPRequest.Method?
    private(set) var operation: String?
    private(set) var body: Data?
    private let status: HTTPResponse.Status
    private let json: String

    init(status: HTTPResponse.Status, json: String) {
        self.status = status
        self.json = json
    }

    func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws -> (
        HTTPResponse, HTTPBody?
    ) {
        path = request.path
        method = request.method
        operation = operationID
        if let body { self.body = try await Data(collecting: body, upTo: 100_000) }
        return (HTTPResponse(status: status, headerFields: [.contentType: "application/json"]), HTTPBody(json))
    }
}
