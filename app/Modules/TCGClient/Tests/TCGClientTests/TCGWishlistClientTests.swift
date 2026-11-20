import Foundation
import HTTPTypes
import OpenAPIRuntime
import Testing

@testable import TCGClient

struct TCGWishlistClientTests {
    private static let key = String(repeating: "a", count: 64)

    @Test func `Saves by the selected daily record and accepts an empty successful response`() async throws {
        let transport = WishlistTransport(status: .noContent, response: nil)
        let payload = SaveWishlistPrinting(pricedCardID: "550e8400-e29b-41d4-a716-446655440000")
        try await makeClient(transport).save(payload).get()
        let request = try #require(await transport.request)
        #expect(request.method == .post)
        #expect(request.path == "/app-api/wishlist")
        #expect(await transport.operationID == "post/app-api/wishlist")
        let body = try #require(await transport.body)
        #expect(try JSONDecoder().decode(SaveWishlistPrinting.self, from: body) == payload)
    }

    @Test func `Removes the printing using the stable key`() async throws {
        let transport = WishlistTransport(status: .noContent, response: nil)
        try await makeClient(transport).remove(printingKey: Self.key).get()
        let request = try #require(await transport.request)
        #expect(request.method == .delete)
        #expect(request.path == "/app-api/wishlist/\(Self.key)")
        #expect(await transport.operationID == "delete/app-api/wishlist/{printingKey}")
    }

    @Test func `Decodes saved metadata and the cursor`() async throws {
        let transport = WishlistTransport(
            status: .ok,
            response: """
                {
                  "entries": [{
                    "id": "550e8400-e29b-41d4-a716-446655440000",
                    "printing_key": "\(Self.key)",
                    "game": "one_piece",
                    "name": "Monkey.D.Luffy",
                    "card_number": "OP05-119",
                    "variant_name": "Alternate Art",
                    "priced_on": "2026-11-17T00:00:00.000Z",
                    "fetched_at": "2026-11-17T10:00:00.000Z"
                  }],
                  "available_set_names": ["Base Set", "Crown Zenith"],
                  "available_illustrators": ["Mitsuhiro Arita"],
                  "next_cursor": "next"
                }
                """
        )
        let page = try await makeClient(transport).list(cursor: "previous", query: "Monkey D. Luffy").get()
        #expect(page.entries.map(\.printingKey) == [Self.key])
        #expect(page.entries.map(\.variantName) == ["Alternate Art"])
        #expect(page.nextCursor == "next")
        #expect(page.availableSetNames == ["Base Set", "Crown Zenith"])
        #expect(page.availableIllustrators == ["Mitsuhiro Arita"])
        let request = try #require(await transport.request)
        #expect(request.method == .get)
        let path = try #require(request.path)
        let url = try #require(URLComponents(string: path))
        #expect(url.path == "/app-api/wishlist")
        #expect(
            url.queryItems == [
                URLQueryItem(name: "query", value: "Monkey D. Luffy"),
                URLQueryItem(name: "cursor", value: "previous"),
            ]
        )
        #expect(await transport.operationID == "get/app-api/wishlist")
    }

    @Test func `Serializes game and repeated filter parameters`() async throws {
        let transport = WishlistTransport(status: .ok, response: #"{"entries":[],"next_cursor":null}"#)
        let filters = CardListFilters(
            game: .pokemon,
            setNames: ["Crown Zenith", "Base Set"],
            illustrators: ["Mitsuhiro Arita", "Ken Sugimori"],
            query: " Pikachu "
        )
        _ = try await makeClient(transport).list(.init(filters: filters, cursor: "previous")).get()

        let request = try #require(await transport.request)
        let path = try #require(request.path)
        let url = try #require(URLComponents(string: path))
        #expect(
            url.queryItems == [
                URLQueryItem(name: "illustrator", value: "Ken Sugimori"),
                URLQueryItem(name: "illustrator", value: "Mitsuhiro Arita"),
                URLQueryItem(name: "game", value: ClientCardGame.pokemon.rawValue),
                URLQueryItem(name: "set_name", value: "Base Set"),
                URLQueryItem(name: "set_name", value: "Crown Zenith"),
                URLQueryItem(name: "query", value: "Pikachu"),
                URLQueryItem(name: "cursor", value: "previous"),
            ]
        )
    }

    @Test func `Omits the search query for an unfiltered page`() async throws {
        let transport = WishlistTransport(status: .ok, response: #"{"entries":[],"next_cursor":null}"#)
        _ = try await makeClient(transport).list(cursor: "previous").get()
        let request = try #require(await transport.request)
        #expect(request.path == "/app-api/wishlist?cursor=previous")
    }

    @Test func `Decodes Wishlist prices in the preferred currency`() async throws {
        let transport = WishlistTransport(
            status: .ok,
            response: """
                {
                  "entries": [{
                    "id": "550e8400-e29b-41d4-a716-446655440000",
                    "printing_key": "\(Self.key)",
                    "game": "one_piece",
                    "name": "Monkey.D.Luffy",
                    "card_number": "OP05-119",
                    "priced_on": "2026-11-17T00:00:00.000Z",
                    "fetched_at": "2026-11-17T10:00:00.000Z",
                    "headline": {"amount": 25, "currency": "USD", "metric": "lowest_near_mint"},
                    "display": {
                      "preferred_currency": "EUR",
                      "conversion_unavailable": false,
                      "headline": {"amount": 20, "currency": "EUR", "metric": "lowest_near_mint"},
                      "market": {"condition": "near_mint", "currency": "EUR", "market": 24}
                    }
                  }],
                  "next_cursor": null
                }
                """
        )
        let page = try await makeClient(transport).list(cursor: nil).get()
        let card = try #require(page.entries.first)
        #expect(card.headline?.amount == 25)
        #expect(card.displayHeadline?.amount == 20)
        #expect(card.displayHeadline?.currency == .eur)
        #expect(card.displayMarket?.market == 24)
        #expect(!card.conversionUnavailable)
    }

    @Test func `Maps an unknown pricing record`() async {
        let transport = WishlistTransport(status: .notFound, response: #"{"message":"Pricing record not found"}"#)
        await #expect(throws: WishlistError.notFound) {
            try await makeClient(transport).save(.init(pricedCardID: "550e8400-e29b-41d4-a716-446655440000")).get()
        }
    }

    @Test func `Maps authentication failure`() async {
        let transport = WishlistTransport(status: .unauthorized, response: #"{"message":"Authentication required"}"#)
        await #expect(throws: WishlistError.unauthorized) {
            try await makeClient(transport).list(cursor: nil).get()
        }
    }

    @Test func `Maps invalid list input`() async {
        let transport = WishlistTransport(
            status: .badRequest,
            response: #"{"code":"INVALID_PAYLOAD","message":"Invalid payload"}"#
        )
        await #expect(throws: WishlistError.validation([])) {
            try await makeClient(transport).list(cursor: "invalid").get()
        }
    }

    private func makeClient(_ transport: WishlistTransport) -> TCGWishlistClientImpl {
        TCGWishlistClientImpl(
            client: Client(
                serverURL: Self.serverURL,
                configuration: .init(dateTranscoder: .iso8601WithFractionalSeconds),
                transport: transport
            )
        )
    }

    private static let serverURL = URL(string: "https://example.com")!
}

private actor WishlistTransport: ClientTransport {
    let status: HTTPResponse.Status
    let response: String?
    var request: HTTPRequest?
    var body: Data?
    var operationID: String?

    init(status: HTTPResponse.Status, response: String?) {
        self.status = status
        self.response = response
    }

    func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws -> (
        HTTPResponse, HTTPBody?
    ) {
        self.request = request
        self.operationID = operationID
        if let body { self.body = try await Data(collecting: body, upTo: .max) }
        return (
            HTTPResponse(status: status, headerFields: [.contentType: "application/json"]),
            response.map { HTTPBody($0) }
        )
    }
}
