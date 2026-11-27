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
    func `Decodes a One Piece alternate art through the generated search client`() async throws {
        let body = Data(
            """
            {"entries":[{"id":"zoro-alt","game":"one_piece","name":"Roronoa Zoro","card_number":"OP01-025",
              "variant_name":"altArt","image_url":"https://images.example.com/zoro-alt.png","is_wishlisted":true,
              "catalog_sets":[{"id":"op01","name":"Romance Dawn"},{"id":"prb01","name":"The Best"}],
              "priced_on":"2026-10-16T00:00:00.000Z","fetched_at":"2026-10-16T10:00:00.000Z"}], "next_cursor": null}
            """.utf8
        )
        let transport = PricingRequestTransport(status: .ok, body: body)
        let result = try await makeClient(transport: transport).pricing.search(
            .init(game: .onePiece, query: "OP01-025", languages: [], mode: .card, cursor: nil)
        )
        .get()
        let match = try #require(result.matches.first)
        #expect(match.id == "zoro-alt")
        #expect(match.variantName == "altArt")
        #expect(match.isWishlisted == true)
        #expect(match.catalogSets?.map(\.id) == ["op01", "prb01"])
        #expect(match.englishSearchAlias == nil)
        #expect(match.imageURL?.absoluteString == "https://images.example.com/zoro-alt.png")
    }

    @Test
    func `Searches illustrators through the generated client and decodes their names`() async throws {
        let body = Data(
            """
            {"entries":[{"id":"illustrator-card","game":"pokemon","name":"ギラティナVSTAR","card_number":"GG69",
              "english_search_alias":"Giratina VSTAR",
              "illustrator":"Akira Egawa","priced_on":"2026-10-16T00:00:00.000Z","fetched_at":"2026-10-16T10:00:00.000Z"}], "next_cursor": null}
            """.utf8
        )
        let transport = PricingRequestTransport(status: .ok, body: body)
        let result = try await makeClient(transport: transport).pricing.search(
            .init(game: .pokemon, query: "Akira Egawa", languages: [.japanese], mode: .illustrator, cursor: nil)
        )
        .get()
        let request = try #require(await transport.request)
        #expect(
            request.path
                == "/app-api/pricing/search?search_by=illustrator&languages=ja&game=pokemon&query=Akira%20Egawa"
        )
        #expect(result.matches.first?.illustrator == "Akira Egawa")
        #expect(result.matches.first?.englishSearchAlias == "Giratina VSTAR")
        #expect(result.matches.first?.gradedPrices == nil)
        #expect(result.matches.first?.displayGradedPrices == [])
    }

    @Test
    func `Decodes preferred-currency display prices without replacing source market amounts`() async throws {
        let body = Data(
            """
            {"entries":[{
              "id":"display-card","game":"pokemon","name":"Pikachu","card_number":"58",
              "headline":{"amount":12.5,"currency":"USD","metric":"lowest_near_mint"},
              "market":{"condition":"near_mint","currency":"USD","market":25},
              "condition_prices":[{"condition":"excellent","currency":"USD","market":20}],
              "condition_values":[{"condition":"good","currency":"USD","amount":18,"basis":"adjusted"}],
              "graded_prices":[{"company":"PSA","grade":10,"currency":"USD","low":80,"market":100,"population":125},
                {"company":"BGS","grade":9.5,"currency":"CAD","market":90}],
              "display":{"preferred_currency":"EUR","conversion_unavailable":false,
                "headline":{"amount":10,"currency":"EUR","metric":"lowest_near_mint"},
                "condition_prices":[{"condition":"excellent","currency":"EUR","market":16}],
                "condition_values":[{"condition":"good","currency":"EUR","amount":14.4,"basis":"adjusted"}],
                "graded_prices":[{"company":"PSA","grade":10,"currency":"EUR","low":64,"market":80,"population":125},
                  {"company":"BGS","grade":9.5,"currency":"CAD","market":90}],
                "market":{"condition":"near_mint","currency":"EUR","market":20,
                  "trend_7d":{"price_change":-2,"percent_change":-10}}},
              "priced_on":"2026-10-16T00:00:00.000Z","fetched_at":"2026-10-16T10:00:00.000Z"
            }], "next_cursor": null}
            """.utf8
        )
        let transport = PricingRequestTransport(status: .ok, body: body)
        let result = try await makeClient(transport: transport).pricing.search(
            .init(game: .pokemon, query: "Pikachu", languages: [], mode: .card, cursor: nil)
        )
        .get()
        let card = try #require(result.matches.first)
        #expect(card.headline?.currency == .usd)
        #expect(card.market?.market == 25)
        #expect(card.display?.preferredCurrency == .eur)
        #expect(card.displayHeadline?.amount == 10)
        #expect(card.displayHeadline?.currency == .eur)
        #expect(card.displayMarket?.market == 20)
        #expect(card.displayMarket?.trend7d == PriceMovement(priceChange: -2, percentChange: -10))
        #expect(card.conditionPrices?.first?.market == 20)
        #expect(card.displayConditionPrices.first?.condition == .excellent)
        #expect(card.displayConditionPrices.first?.market == 16)
        #expect(card.conditionValues?.first?.basis == .adjusted)
        #expect(card.displayConditionValues?.first?.amount == 14.4)
        #expect(
            card.gradedPrices == [
                GradedPrice(company: "PSA", grade: 10, currency: .usd, low: 80, market: 100, population: 125),
                GradedPrice(company: "BGS", grade: 9.5, currency: .cad, low: nil, market: 90, population: nil),
            ]
        )
        #expect(
            card.displayGradedPrices == [
                GradedPrice(company: "PSA", grade: 10, currency: .eur, low: 64, market: 80, population: 125),
                GradedPrice(company: "BGS", grade: 9.5, currency: .cad, low: nil, market: 90, population: nil),
            ]
        )
        #expect(!card.conversionUnavailable)
    }

    @Test
    func `Decodes only supported currencies`() throws {
        let decoder = JSONDecoder()

        #expect(try decoder.decode(Currency.self, from: Data(#""JPY""#.utf8)) == .jpy)
        #expect(throws: DecodingError.self) {
            try decoder.decode(Currency.self, from: Data(#""XYZ""#.utf8))
        }
    }

    @Test
    func `Searches through the generated pricing operation`() async throws {
        let transport = PricingRequestTransport(status: .ok, body: searchJSON)
        let result = try await makeClient(transport: transport).pricing
            .search(.init(game: .pokemon, query: "Giratina VSTAR GG69", languages: [], mode: .card, cursor: nil))
            .get()
        let request = try #require(await transport.request)

        #expect(request.method == .get)
        #expect(request.path == "/app-api/pricing/search?search_by=card&game=pokemon&query=Giratina%20VSTAR%20GG69")
        #expect(request.operationID == "get/app-api/pricing/search")
        #expect(result.matches == [expectedPricedCard])
        #expect(result.nextCursor == nil)
    }

    @Test
    func `Passes the cursor through the generated client and decodes the next cursor`() async throws {
        let body = Data(
            """
            {"entries": [], "next_cursor": "third-page"}
            """.utf8
        )
        let transport = PricingRequestTransport(status: .ok, body: body)
        let result = try await makeClient(transport: transport).pricing
            .search(.init(game: .pokemon, query: "Pikachu", languages: [], mode: .card, cursor: "second-page"))
            .get()
        let request = try #require(await transport.request)

        #expect(request.path == "/app-api/pricing/search?search_by=card&cursor=second-page&game=pokemon&query=Pikachu")
        #expect(result.nextCursor == "third-page")
    }

    @Test(arguments: [ClientCardLanguage.english, .japanese])
    func `Serializes a partial language selection`(language: ClientCardLanguage) async throws {
        let transport = PricingRequestTransport(status: .ok, body: searchJSON)
        let result = try await makeClient(transport: transport).pricing
            .search(.init(game: .pokemon, query: "Giratina", languages: [language], mode: .card, cursor: nil))
            .get()
        let request = try #require(await transport.request)

        #expect(
            request.path
                == "/app-api/pricing/search?search_by=card&languages=\(language.rawValue)&game=pokemon&query=Giratina"
        )
        #expect(result.matches == [expectedPricedCard])
    }

    @Test(arguments: [Set<ClientCardLanguage>(), [.english, .japanese]])
    func `Omits unrestricted language selections`(languages: Set<ClientCardLanguage>) async throws {
        let transport = PricingRequestTransport(status: .ok, body: searchJSON)
        let result = try await makeClient(transport: transport).pricing
            .search(.init(game: .pokemon, query: "Giratina", languages: languages, mode: .card, cursor: nil))
            .get()
        let request = try #require(await transport.request)

        #expect(request.path == "/app-api/pricing/search?search_by=card&game=pokemon&query=Giratina")
        #expect(result.matches == [expectedPricedCard])
    }

    @Test
    func `Selecting the only One Piece language is unrestricted`() async throws {
        let transport = PricingRequestTransport(status: .ok, body: searchJSON)
        let result = try await makeClient(transport: transport).pricing
            .search(.init(game: .onePiece, query: "Nami", languages: [.english], mode: .card, cursor: nil))
            .get()
        let request = try #require(await transport.request)

        #expect(request.path == "/app-api/pricing/search?search_by=card&game=one_piece&query=Nami")
        #expect(result.matches == [expectedPricedCard])
    }

    @Test
    func `Search decodes responses without set metadata`() async throws {
        let body = Data(
            String(decoding: searchJSON, as: UTF8.self)
                .replacingOccurrences(
                    of: "\"set_name\": \"Crown Zenith\",",
                    with: ""
                ).utf8
        )
        let transport = PricingRequestTransport(status: .ok, body: body)
        let result = try await makeClient(transport: transport).pricing.search(
            .init(game: .pokemon, query: "Giratina", languages: [], mode: .card, cursor: nil)
        )
        .get()
        let card = try #require(result.matches.first)
        #expect(card.setName == nil)
        #expect(card.name == "Giratina VSTAR")
    }

    @Test
    func `Maps pricing validation errors`() async {
        let searchTransport = PricingRequestTransport(status: .badRequest, body: validationJSON)

        await #expect(throws: SearchPricingErrors.badRequest(validations: [validationIssue])) {
            try await makeClient(transport: searchTransport).pricing.search(
                .init(game: .pokemon, query: "x", languages: [], mode: .card, cursor: nil)
            )
            .get()
        }
    }

    @Test
    func `Maps missing pricing sessions to unauthorized`() async {
        let searchTransport = PricingRequestTransport(status: .unauthorized, body: errorJSON)

        await #expect(throws: SearchPricingErrors.unauthorized) {
            try await makeClient(transport: searchTransport).pricing
                .search(.init(game: .pokemon, query: "Giratina", languages: [], mode: .card, cursor: nil))
                .get()
        }
    }

    @Test
    func `Maps pricing lock timeouts to unavailable`() async {
        let searchTransport = PricingRequestTransport(status: .serviceUnavailable, body: errorJSON)

        await #expect(throws: SearchPricingErrors.unavailable) {
            try await makeClient(transport: searchTransport).pricing.search(
                .init(game: .pokemon, query: "Giratina", languages: [], mode: .card, cursor: nil)
            )
            .get()
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
    printingKey: nil,
    isWishlisted: nil,
    game: .pokemon,
    name: "Giratina VSTAR",
    cardNumber: "GG69",
    setName: "Crown Zenith",
    rarity: "Secret Rare",
    illustrator: nil,
    englishSearchAlias: nil,
    variantName: nil,
    imageURL: nil,
    headline: .init(amount: 146.69, currency: .usd, metric: .lowestNearMint),
    market: .init(
        condition: .nearMint,
        currency: .usd,
        low: 146.69,
        market: 172.42,
        trend7d: .init(priceChange: 7.36, percentChange: 4.46),
        trend30d: .init(priceChange: 13.88, percentChange: 8.75)
    ),
    conditionPrices: nil,
    conditionValues: nil,
    display: nil,
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
      "set_name": "Crown Zenith",
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
      "entries": [\(pricedCardJSON)],
      "next_cursor": null
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
