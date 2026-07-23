//
//  TCGPricingClientTests.swift
//  TCGClient
//

import Foundation
import HTTPTypes
import OpenAPIRuntime
import Testing

@testable import TCGClient

@Suite("TCGClient Pricing Tests")
struct TCGPricingClientTests {
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
        #expect(result.status == .ok)
        #expect(result.matches == [expectedPricedCard])
    }

    @Test
    func `Loads owned prices with an optional game filter`() async throws {
        let transport = PricingRequestTransport(status: .ok, body: ownedJSON)
        let prices = try await makeClient(transport: transport).pricing.ownedPrices(game: .pokemon).get()
        let request = try #require(await transport.request)

        #expect(request.method == .get)
        #expect(request.path == "/app-api/pricing/owned?game=pokemon")
        #expect(request.operationID == "get/app-api/pricing/owned")
        #expect(prices == [.init(cardId: "card-id", status: .priced, price: expectedPricedCard)])
    }

    @Test
    func `Maps pricing validation errors`() async {
        let searchTransport = PricingRequestTransport(status: .badRequest, body: validationJSON)
        let ownedTransport = PricingRequestTransport(status: .badRequest, body: validationJSON)

        await #expect(throws: SearchPricingErrors.badRequest(validations: [validationIssue])) {
            try await makeClient(transport: searchTransport).pricing.search(game: .pokemon, query: "x").get()
        }
        await #expect(throws: OwnedPricesErrors.badRequest(validations: [validationIssue])) {
            try await makeClient(transport: ownedTransport).pricing.ownedPrices(game: .pokemon).get()
        }
    }

    @Test
    func `Maps missing pricing sessions to unauthorized`() async {
        let searchTransport = PricingRequestTransport(status: .notFound, body: errorJSON)
        let ownedTransport = PricingRequestTransport(status: .notFound, body: errorJSON)

        await #expect(throws: SearchPricingErrors.unauthorized) {
            try await makeClient(transport: searchTransport).pricing
                .search(game: .pokemon, query: "Giratina")
                .get()
        }
        await #expect(throws: OwnedPricesErrors.unauthorized) {
            try await makeClient(transport: ownedTransport).pricing.ownedPrices(game: nil).get()
        }
    }

    @Test
    func `Maps pricing lock timeouts to unavailable`() async {
        let searchTransport = PricingRequestTransport(status: .serviceUnavailable, body: errorJSON)
        let ownedTransport = PricingRequestTransport(status: .serviceUnavailable, body: errorJSON)

        await #expect(throws: SearchPricingErrors.unavailable) {
            try await makeClient(transport: searchTransport).pricing.search(game: .pokemon, query: "Giratina").get()
        }
        await #expect(throws: OwnedPricesErrors.unavailable) {
            try await makeClient(transport: ownedTransport).pricing.ownedPrices(game: nil).get()
        }
    }

    private func makeClient(transport: PricingRequestTransport) -> TCGClient {
        let credentials = Credentials(
            authToken: "auth-token",
            expiryDate: .distantFuture,
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
    tcggoCardId: "pokemon-giratina-vstar-gg69",
    game: .pokemon,
    name: "Giratina VSTAR",
    cardNumber: "GG69",
    rarity: "Secret Rare",
    headline: .init(amount: 146.69, currency: "EUR"),
    cardmarket: .init(
        currency: "EUR",
        lowestNearMint: 146.69,
        average7d: 151.24,
        average30d: 143.88,
        trend: .up
    ),
    tcgplayer: .init(currency: "USD", marketPrice: 172.42, midPrice: 178.10),
    pricedOn: "2026-07-23",
    fetchedAt: Date(timeIntervalSince1970: 1_753_266_600)
)

private let pricedCardJSON =
    """
    {
      "tcggo_card_id": "pokemon-giratina-vstar-gg69",
      "game": "pokemon",
      "name": "Giratina VSTAR",
      "card_number": "GG69",
      "rarity": "Secret Rare",
      "headline": {"amount": 146.69, "currency": "EUR", "metric": "lowest_near_mint"},
      "cardmarket": {
        "currency": "EUR",
        "lowest_near_mint": 146.69,
        "average_7d": 151.24,
        "average_30d": 143.88,
        "trend": "up"
      },
      "tcgplayer": {"currency": "USD", "market_price": 172.42, "mid_price": 178.10},
      "priced_on": "2026-07-23",
      "fetched_at": "2025-07-23T10:30:00.000Z"
    }
    """
private let searchJSON = Data(
    """
    {
      "query": "Giratina VSTAR GG69",
      "normalized_query": "Giratina VSTAR GG69",
      "game": "pokemon",
      "status": "ok",
      "matches": [\(pricedCardJSON)]
    }
    """.utf8
)
private let ownedJSON = Data(
    """
    {"prices": [{"card_id": "card-id", "status": "priced", "price": \(pricedCardJSON)}]}
    """.utf8
)
private let validationIssue = TCGClientValidationIssue(code: "too_small", path: ["query"], message: "Required")
private let validationJSON = Data(
    """
    {"message":"Invalid payload","code":"INVALID_PAYLOAD","context":{"validations":[{"code":"too_small","path":["query"],"message":"Required"}]}}
    """.utf8
)
private let errorJSON = Data("{\"message\":\"Not found\",\"code\":\"SESSION_NOT_FOUND\"}".utf8)
