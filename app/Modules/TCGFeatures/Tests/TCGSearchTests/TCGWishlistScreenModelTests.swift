import Foundation
import Testing

@testable import TCGClient
@testable import TCGSearch

@MainActor
struct TCGWishlistScreenModelTests {
    @Test
    func `Discards an old search result after the query changes`() async {
        let gate = WishlistRequestGate()
        let client = WishlistTestClient(
            responses: [.success(.init(entries: [WishlistTestClient.luffy], nextCursor: "old")), Self.empty],
            firstRequestGate: gate
        )
        let wishlist = TCGWishlist(client: client)
        let model = TCGWishlistScreenModel()
        model.query = "  Luffy  "
        let first = Task { await model.refresh(using: wishlist) }
        await gate.waitUntilStarted()

        model.query = "Pikachu"
        await model.refresh(using: wishlist)
        gate.resume()
        await first.value

        #expect(await client.requests == [.init(query: "Luffy", cursor: nil), .init(query: "Pikachu", cursor: nil)])
        #expect(model.entries.isEmpty)
        #expect(model.cursor == nil)
        #expect(model.hasLoaded)
    }

    @Test
    func `Clearing search reloads the unfiltered first page`() async {
        let client = WishlistTestClient(responses: [
            Self.empty, .success(.init(entries: [WishlistTestClient.luffy], nextCursor: nil)),
        ])
        let wishlist = TCGWishlist(client: client)
        let model = TCGWishlistScreenModel()
        model.query = "Pikachu"
        await model.refresh(using: wishlist)

        model.query = " "
        await model.search(using: wishlist)

        #expect(await client.requests == [.init(query: "Pikachu", cursor: nil), .init(query: nil, cursor: nil)])
        #expect(model.entries == [WishlistTestClient.luffy])
    }

    @Test
    func `Retries a failed page with the same query and cursor`() async {
        let client = WishlistTestClient(responses: [
            .success(.init(entries: [WishlistTestClient.luffy], nextCursor: "next")),
            .failure(.unavailable),
            Self.empty,
        ])
        let wishlist = TCGWishlist(client: client)
        let model = TCGWishlistScreenModel()
        model.query = "  Luffy "
        await model.refresh(using: wishlist)
        await model.loadNextPage(using: wishlist)
        #expect(model.error == .unavailable)

        await model.retry(using: wishlist)

        #expect(
            await client.requests == [
                .init(query: "Luffy", cursor: nil),
                .init(query: "Luffy", cursor: "next"),
                .init(query: "Luffy", cursor: "next"),
            ]
        )
        #expect(model.entries == [WishlistTestClient.luffy])
        #expect(model.cursor == nil)
        #expect(model.error == nil)
    }

    @Test
    func `A response in flight cannot restore a removed printing`() async {
        let gate = WishlistRequestGate()
        let client = WishlistTestClient(
            responses: [.success(.init(entries: [WishlistTestClient.luffy], nextCursor: nil))],
            firstRequestGate: gate
        )
        let wishlist = TCGWishlist(client: client)
        let model = TCGWishlistScreenModel()
        let refresh = Task { await model.refresh(using: wishlist) }
        await gate.waitUntilStarted()

        model.didRemove(WishlistTestClient.luffy)
        gate.resume()
        await refresh.value

        #expect(model.entries.isEmpty)
        #expect(!model.isLoading)
    }

    private static let empty: Result<WishlistPage, WishlistError> = .success(.init(entries: [], nextCursor: nil))
}

actor WishlistTestClient: TCGWishlistClient {
    struct Request: Equatable {
        let query: String?
        let cursor: String?
    }

    static let luffy = PricedCard(
        id: "550e8400-e29b-41d4-a716-446655440000",
        printingKey: String(repeating: "a", count: 64),
        game: .onePiece,
        name: "Monkey.D.Luffy",
        cardNumber: "OP05-119",
        setName: "Awakening of the New Era",
        illustrator: nil,
        variantName: "Alternate Art",
        pricedOn: Date(timeIntervalSince1970: 0),
        fetchedAt: Date(timeIntervalSince1970: 0)
    )

    private(set) var requests: [Request] = []
    private var responses: [Result<WishlistPage, WishlistError>]
    private let firstRequestGate: WishlistRequestGate?

    init(responses: [Result<WishlistPage, WishlistError>] = [], firstRequestGate: WishlistRequestGate? = nil) {
        self.responses = responses
        self.firstRequestGate = firstRequestGate
    }

    func list(cursor: String?, query: String?) async -> Result<WishlistPage, WishlistError> {
        requests.append(.init(query: query, cursor: cursor))
        guard !responses.isEmpty else { return .failure(.unavailable) }
        let response = responses.removeFirst()
        if requests.count == 1, let firstRequestGate {
            await firstRequestGate.suspendRequest()
        }
        return response
    }

    func save(_ payload: SaveWishlistPrinting) async -> Result<Void, WishlistError> { .success(()) }

    func remove(printingKey: String) async -> Result<Void, WishlistError> { .success(()) }
}

struct WishlistRequestGate: Sendable {
    private let started = AsyncStream<Void>.makeStream()
    private let released = AsyncStream<Void>.makeStream()

    func suspendRequest() async {
        started.continuation.yield(())
        var iterator = released.stream.makeAsyncIterator()
        _ = await iterator.next()
    }

    func waitUntilStarted() async {
        var iterator = started.stream.makeAsyncIterator()
        _ = await iterator.next()
    }

    func resume() {
        released.continuation.yield(())
    }
}
