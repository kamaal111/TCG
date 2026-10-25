import Foundation
import HTTPTypes
import KamaalLogger
import OpenAPIRuntime
import Testing

@testable import TCGClient

@Suite("Currency client transport")
struct TCGCurrencyClientTests {
    @Test(arguments: [
        (401, "unauthorized", LogLevels.warning),
        (503, "unavailable", LogLevels.warning),
        (418, "unexpected_status", LogLevels.error),
        (200, "decoding_failed", LogLevels.error),
    ])
    func `Logs safe HTTP failure diagnostics`(status: Int, reason: String, level: LogLevels) async throws {
        let holder = LogHolder(max: nil)
        let client = try loggedClient(
            CurrencyTransport(status: .init(code: status), json: "{\"message\":\"never-log-me\",\"code\":\"ERROR\"}"),
            holder: holder
        )
        let result = await client.latestRates()
        let logs = await clientLogs(holder)
        let entry = try #require(logs.first)
        #expect(entry.level == level)
        #expect(entry.message.contains("event=currency.request.failed; operation=latest_rates; reason=\(reason)"))
        #expect(entry.message.contains("status=\(status)"))
        #expect(logs.allSatisfy { !$0.message.contains("never-log-me") && !$0.message.contains("private") })
        #expect(throws: (any Error).self) { try result.get() }
    }

    @Test(arguments: [
        ("{\"USD\":1.25}", "invalid_base_rate"),
        ("{\"EUR\":2,\"USD\":1.25}", "invalid_base_rate"),
        ("{\"EUR\":1,\"USD\":0}", "invalid_rate"),
    ])
    func `Logs the reason invalid rate snapshots were rejected`(rates: String, reason: String) async throws {
        let holder = LogHolder(max: nil)
        let client = try loggedClient(
            CurrencyTransport(status: .ok, json: "{\"base\":\"EUR\",\"date\":\"2026-10-16\",\"rates\":\(rates)}"),
            holder: holder
        )
        await #expect(throws: CurrencyClientError.unknown) { try await client.latestRates().get() }
        let logs = await clientLogs(holder)
        #expect(logs.contains { $0.level == .error && $0.message.contains("reason=\(reason); status=200") })
    }

    @Test
    func `Logs transport failure without its sensitive error description`() async throws {
        let holder = LogHolder(max: nil)
        let client = try loggedClient(
            CurrencyTransport(status: .ok, json: "", failure: .notConnectedToInternet),
            holder: holder
        )
        await #expect(throws: CurrencyClientError.unknown) { try await client.latestRates().get() }
        let logs = await clientLogs(holder)
        #expect(logs.contains { $0.level == .warning && $0.message.contains("reason=transport_failed; status=none") })
        #expect(logs.allSatisfy { !$0.message.contains("never-log-me") })
    }

    @Test
    func `Logs cancelled requests as debug rather than failures`() async throws {
        let holder = LogHolder(max: nil)
        let client = try loggedClient(CurrencyTransport(status: .ok, json: "", failure: .cancelled), holder: holder)
        await #expect(throws: CurrencyClientError.unknown) { try await client.latestRates().get() }
        let logs = await clientLogs(holder)
        #expect(logs.count == 1)
        #expect(
            logs.contains {
                $0.level == .debug && $0.message == "event=currency.request.cancelled; operation=latest_rates"
            }
        )
    }

    private func loggedClient(_ transport: CurrencyTransport, holder: LogHolder) throws -> TCGCurrencyClientImpl {
        TCGCurrencyClientImpl(
            client: Client(serverURL: try #require(URL(string: "http://localhost:8080")), transport: transport),
            logger: KamaalLogger(from: TCGCurrencyClientImpl.self, holder: holder)
        )
    }

    @Test
    func `Sends and maps the preferred currency update`() async throws {
        let transport = CurrencyTransport(status: .ok, json: Self.session)
        let client = TCGCurrencyClientImpl(
            client: Client(serverURL: URL(string: "http://localhost:8080")!, transport: transport)
        )
        let preference = try await client.update(.init(preferredCurrency: .eur)).get()
        let body = try #require(await transport.body)
        #expect(try JSONDecoder().decode(CurrencyPreferencePayload.self, from: body).preferredCurrency == .eur)
        #expect(try JSONDecoder().decode([String: String].self, from: body) == ["preferred_currency": "EUR"])
        #expect(await transport.method == .patch)
        #expect(await transport.path == "/app-api/auth/preferences")
        #expect(preference.currency == .eur)
    }

    @Test
    func `Initializes a preference using POST with only the currency payload`() async throws {
        let transport = CurrencyTransport(status: .ok, json: Self.session)
        let client = TCGCurrencyClientImpl(
            client: Client(serverURL: URL(string: "http://localhost:8080")!, transport: transport)
        )
        let preference = try await client.initialize(.init(preferredCurrency: .eur)).get()
        let body = try #require(await transport.body)
        #expect(try JSONDecoder().decode(CurrencyPreferencePayload.self, from: body).preferredCurrency == .eur)
        #expect(try JSONDecoder().decode([String: String].self, from: body) == ["preferred_currency": "EUR"])
        #expect(await transport.method == .post)
        #expect(await transport.path == "/app-api/auth/preferences")
        #expect(await transport.operation == "post/app-api/auth/preferences")
        #expect(preference.currency == .eur)
    }

    @Test
    func `Maps unauthorized preference initialization`() async {
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
            try await client.initialize(.init(preferredCurrency: .eur)).get()
        }
    }

    @Test
    func `Maps initialization validation failures`() async {
        let transport = CurrencyTransport(
            status: .badRequest,
            json: """
                {"message":"Invalid payload","code":"INVALID_PAYLOAD","context":{"validations":[{"code":"invalid_value","path":["preferred_currency"],"message":"Unsupported currency"}]}}
                """
        )
        let client = TCGCurrencyClientImpl(
            client: Client(serverURL: URL(string: "http://localhost:8080")!, transport: transport)
        )
        await #expect(
            throws: CurrencyClientError.badRequest(validations: [
                .init(code: "invalid_value", path: ["preferred_currency"], message: "Unsupported currency")
            ])
        ) {
            try await client.initialize(.init(preferredCurrency: .eur)).get()
        }
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
        {"session":{"expires_at":"2030-01-01T00:00:00Z","created_at":"2026-10-16T00:00:00Z","updated_at":"2026-10-16T00:00:00Z"},"user":{"id":"user-1","name":"User","email":"user@example.com","email_verified":false,"created_at":"2026-10-16T00:00:00Z","preferred_currency":"EUR"}}
        """
}

private actor CurrencyTransport: ClientTransport {
    private(set) var path: String?
    private(set) var method: HTTPRequest.Method?
    private(set) var operation: String?
    private(set) var body: Data?
    private let status: HTTPResponse.Status
    private let json: String
    private let failure: URLError.Code?

    init(status: HTTPResponse.Status, json: String, failure: URLError.Code? = nil) {
        self.status = status
        self.json = json
        self.failure = failure
    }

    func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws -> (
        HTTPResponse, HTTPBody?
    ) {
        if let failure { throw URLError(failure, userInfo: [NSLocalizedDescriptionKey: "never-log-me"]) }
        path = request.path
        method = request.method
        operation = operationID
        if let body { self.body = try await Data(collecting: body, upTo: 100_000) }
        return (HTTPResponse(status: status, headerFields: [.contentType: "application/json"]), HTTPBody(json))
    }
}

private func clientLogs(_ holder: LogHolder) async -> [HoldedLog] {
    let clock = ContinuousClock()
    let deadline = clock.now.advanced(by: .seconds(2))
    while clock.now < deadline {
        let logs = await holder.logs
        if !logs.isEmpty { return logs }
        await Task.yield()
    }
    return await holder.logs
}
