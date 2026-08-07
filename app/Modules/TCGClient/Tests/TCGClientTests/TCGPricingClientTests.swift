//
//  TCGPricingClientTests.swift
//  TCGClient
//

import Foundation
import HTTPTypes
import KamaalAuth
import OpenAPIRuntime
import Testing

@testable import TCGClient

@Suite("TCGClient Pricing Tests")
struct TCGPricingClientTests {
    @Test
    func `Decodes only supported currencies`() throws {
        let decoder = JSONDecoder()

        #expect(try decoder.decode(Currency.self, from: Data(#""JPY""#.utf8)) == .jpy)
        #expect(throws: DecodingError.self) {
            try decoder.decode(Currency.self, from: Data(#""GBP""#.utf8))
        }
    }

    @Test
    func `Searches through the generated pricing operation`() async throws {
        let transport = PricingRequestTransport(status: .ok, body: searchJSON)
        let result = try await makeClient(transport: transport).pricing
            .search(game: .pokemon, query: "Giratina VSTAR GG69")
            .get()
        let request = try #require(await transport.request)

        #expect(request.method == .get)
        #expect(request.path == "/app-api/pricing/search?game=pokemon&query=Giratina%20VSTAR%20GG69")
        #expect(request.operationID == "get/app-api/pricing/search")
        #expect(result.matches == [expectedPricedCard])
    }

    @Test
    func `Maps pricing validation errors`() async {
        let searchTransport = PricingRequestTransport(status: .badRequest, body: validationJSON)

        await #expect(throws: SearchPricingErrors.badRequest(validations: [validationIssue])) {
            try await makeClient(transport: searchTransport).pricing.search(game: .pokemon, query: "x").get()
        }
    }

    @Test
    func `Maps missing pricing sessions to unauthorized`() async {
        let searchTransport = PricingRequestTransport(status: .unauthorized, body: errorJSON)

        await #expect(throws: SearchPricingErrors.unauthorized) {
            try await makeClient(transport: searchTransport).pricing
                .search(game: .pokemon, query: "Giratina")
                .get()
        }
    }

    @Test
    func `Maps pricing lock timeouts to unavailable`() async {
        let searchTransport = PricingRequestTransport(status: .serviceUnavailable, body: errorJSON)

        await #expect(throws: SearchPricingErrors.unavailable) {
            try await makeClient(transport: searchTransport).pricing.search(game: .pokemon, query: "Giratina").get()
        }
    }

    private func makeClient(transport: PricingRequestTransport) -> TCGClient {
        let credentials = Credentials(
            authToken: "auth-token",
            authTokenExpiryDate: .distantFuture,
            sessionToken: "session-token",
            sessionUpdateAge: 1800,
            lastSessionUpdate: .now
        )
        return TCGClient.default(
            transport: transport,
            credentialsKeychainKey: "pricing-test-credentials",
            credentialsStore: InMemoryCredentialsStore(seed: try? JSONEncoder().encode(credentials))
        )
    }
}

private actor PricingRequestTransport: ClientTransport {
    private(set) var request: PricingRecordedRequest?
    private let status: HTTPResponse.Status
    private let body: Data

    init(status: HTTPResponse.Status, body: Data) {
        self.status = status
        self.body = body
    }

    func send(
        _ request: HTTPRequest,
        body _: HTTPBody?,
        baseURL _: URL,
        operationID: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        self.request = PricingRecordedRequest(
            method: request.method,
            path: request.path,
            operationID: operationID
        )
        return (
            HTTPResponse(status: status, headerFields: [.contentType: "application/json"]),
            HTTPBody(body)
        )
    }
}

private struct PricingRecordedRequest: Sendable {
    let method: HTTPRequest.Method
    let path: String?
    let operationID: String
}

private let expectedPricedCard = PricedCard(
    id: "550e8400-e29b-41d4-a716-446655440000",
    game: .pokemon,
    name: "Giratina VSTAR",
    cardNumber: "GG69",
    rarity: "Secret Rare",
    headline: .init(amount: 146.69, currency: .usd),
    market: .init(
        currency: .usd,
        low: 146.69,
        market: 172.42,
        trend7d: .init(priceChange: 7.36, percentChange: 4.46),
        trend30d: .init(priceChange: 13.88, percentChange: 8.75)
    ),
    pricedOn: Date(timeIntervalSince1970: 1_784_764_800),
    fetchedAt: Date(timeIntervalSince1970: 1_753_266_600)
)

private let pricedCardJSON =
    """
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "game": "pokemon",
      "name": "Giratina VSTAR",
      "card_number": "GG69",
      "rarity": "Secret Rare",
      "headline": {"amount": 146.69, "currency": "USD", "metric": "lowest_near_mint"},
      "market": {
        "condition": "near_mint",
        "currency": "USD",
        "low": 146.69,
        "market": 172.42,
        "trend_7d": {"price_change": 7.36, "percent_change": 4.46},
        "trend_30d": {"price_change": 13.88, "percent_change": 8.75}
      },
      "priced_on": "2026-07-23T00:00:00.000Z",
      "fetched_at": "2025-07-23T10:30:00.000Z"
    }
    """
private let searchJSON = Data(
    """
    {
      "query": "Giratina VSTAR GG69",
      "normalized_query": "Giratina VSTAR GG69",
      "game": "pokemon",
      "matches": [\(pricedCardJSON)]
    }
    """.utf8
)
private let validationIssue = TCGClientValidationIssue(code: "too_small", path: ["query"], message: "Required")
private let validationJSON = Data(
    """
    {
      "message": "Invalid payload",
      "code": "INVALID_PAYLOAD",
      "context": {
        "validations": [
          {
            "code": "too_small",
            "path": ["query"],
            "message": "Required"
          }
        ]
      }
    }
    """.utf8
)
private let errorJSON = Data(
    """
    {
      "message": "Not found",
      "code": "SESSION_NOT_FOUND"
    }
    """.utf8
)
