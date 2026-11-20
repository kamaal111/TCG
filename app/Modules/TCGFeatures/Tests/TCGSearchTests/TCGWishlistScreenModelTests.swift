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

    @Test
    func `Restores two pages from disk and revalidates both at fifteen minutes`() async {
        let cache = WishlistCacheFixture()
        defer { try? FileManager.default.removeItem(at: cache.root) }
        let original = WishlistTestClient(responses: [
            .success(.init(entries: [WishlistTestClient.luffy], nextCursor: "page-two")),
            .success(.init(entries: [WishlistTestClient.pikachu], nextCursor: "page-three")),
        ])
        let initial = TCGWishlistScreenModel()
        let originalWishlist = cache.wishlist(client: original)
        await initial.search(using: originalWishlist)
        cache.now = cache.now.addingTimeInterval(60)
        await initial.loadNextPage(using: originalWishlist)
        #expect(initial.cursor == "page-three")

        let gate = WishlistRequestGate()
        let client = WishlistTestClient(
            responses: [
                .success(.init(entries: [WishlistTestClient.pikachu], nextCursor: "new-page-two")),
                .success(.init(entries: [WishlistTestClient.pikachu, WishlistTestClient.luffy], nextCursor: nil)),
            ],
            firstRequestGate: gate
        )
        let wishlist = cache.wishlist(client: client)
        let reopened = TCGWishlistScreenModel()
        cache.now = cache.now.addingTimeInterval(4 * 60)
        await reopened.search(using: wishlist)
        #expect(reopened.entries == [WishlistTestClient.luffy, WishlistTestClient.pikachu])
        #expect(reopened.cursor == "page-three")
        #expect(await client.requests.isEmpty)

        cache.now = cache.now.addingTimeInterval(10 * 60)
        let refresh = Task { await reopened.search(using: wishlist) }
        await gate.waitUntilStarted()
        #expect(reopened.entries == [WishlistTestClient.luffy, WishlistTestClient.pikachu])
        gate.resume()
        await refresh.value

        #expect(await client.requests == [.init(query: nil, cursor: nil), .init(query: nil, cursor: "new-page-two")])
        #expect(reopened.entries == [WishlistTestClient.pikachu, WishlistTestClient.luffy])
        #expect(reopened.cursor == nil)
    }

    @Test
    func `Cached searches are separate and successful empty results are fresh`() async {
        let cache = WishlistCacheFixture()
        defer { try? FileManager.default.removeItem(at: cache.root) }
        let client = WishlistTestClient(responses: [
            .success(.init(entries: [WishlistTestClient.luffy], nextCursor: nil)),
            Self.empty,
        ])
        let wishlist = cache.wishlist(client: client)
        let model = TCGWishlistScreenModel()
        model.query = "Luffy"
        await model.refresh(using: wishlist)
        model.query = "Pikachu"
        await model.refresh(using: wishlist)

        let reopened = TCGWishlistScreenModel()
        reopened.query = "  Luffy  "
        await reopened.search(using: wishlist)
        #expect(reopened.entries == [WishlistTestClient.luffy])
        reopened.query = "Pikachu"
        await reopened.search(using: wishlist)
        #expect(reopened.entries.isEmpty)
        #expect(reopened.hasLoaded)
        #expect(await client.requests == [.init(query: "Luffy", cursor: nil), .init(query: "Pikachu", cursor: nil)])
    }

    @Test
    func `A currency change refreshes a fresh list while retaining its rows`() async {
        let cache = WishlistCacheFixture()
        defer { try? FileManager.default.removeItem(at: cache.root) }
        let initialClient = WishlistTestClient(responses: [
            .success(.init(entries: [WishlistTestClient.luffy], nextCursor: nil))
        ])
        await TCGWishlistScreenModel().search(using: cache.wishlist(client: initialClient), currency: .usd)

        let gate = WishlistRequestGate()
        let client = WishlistTestClient(
            responses: [.success(.init(entries: [WishlistTestClient.pikachu], nextCursor: nil))],
            firstRequestGate: gate
        )
        let wishlist = cache.wishlist(client: client)
        let model = TCGWishlistScreenModel()
        let reload = Task { await model.search(using: wishlist, currency: .eur) }
        await gate.waitUntilStarted()
        #expect(model.entries == [WishlistTestClient.luffy])
        gate.resume()
        await reload.value
        #expect(model.entries == [WishlistTestClient.pikachu])

        let reopened = TCGWishlistScreenModel()
        await reopened.search(using: cache.wishlist(client: client), currency: .eur)
        #expect(reopened.entries == [WishlistTestClient.pikachu])
        #expect(await client.requests.count == 1)
    }

    @Test
    func `A forced refresh keeps cached rows when it fails and retries page one`() async {
        let cache = WishlistCacheFixture()
        defer { try? FileManager.default.removeItem(at: cache.root) }
        let client = WishlistTestClient(responses: [
            .success(.init(entries: [WishlistTestClient.luffy], nextCursor: nil)),
            .failure(.unavailable),
            Self.empty,
        ])
        let wishlist = cache.wishlist(client: client)
        let model = TCGWishlistScreenModel()
        await model.search(using: wishlist)
        await model.refresh(using: wishlist)
        #expect(model.entries == [WishlistTestClient.luffy])
        #expect(model.error == .unavailable)
        await model.retry(using: wishlist)
        #expect(model.entries.isEmpty)
        #expect(model.error == nil)
        #expect(await client.requests.count == 3)
    }

    @Test
    func `Resumes pagination from disk and retries a repeated cursor without publishing the page`() async {
        let cache = WishlistCacheFixture()
        defer { try? FileManager.default.removeItem(at: cache.root) }
        let initialClient = WishlistTestClient(responses: [
            .success(.init(entries: [WishlistTestClient.luffy], nextCursor: "page-two"))
        ])
        await TCGWishlistScreenModel().search(using: cache.wishlist(client: initialClient))

        let client = WishlistTestClient(responses: [
            .success(.init(entries: [WishlistTestClient.pikachu], nextCursor: "page-two")),
            .success(.init(entries: [WishlistTestClient.luffy, WishlistTestClient.pikachu], nextCursor: nil)),
        ])
        let wishlist = cache.wishlist(client: client)
        let model = TCGWishlistScreenModel()
        await model.search(using: wishlist)
        await model.loadNextPage(using: wishlist)
        #expect(model.entries == [WishlistTestClient.luffy])
        #expect(model.error == .unavailable)
        await model.retry(using: wishlist)
        #expect(model.entries == [WishlistTestClient.luffy, WishlistTestClient.pikachu])
        #expect(model.cursor == nil)
        #expect(
            await client.requests == [.init(query: nil, cursor: "page-two"), .init(query: nil, cursor: "page-two")]
        )
    }

    @Test
    func `A late continuation cannot replace a newer first-page snapshot`() async {
        let cache = WishlistCacheFixture()
        defer { try? FileManager.default.removeItem(at: cache.root) }
        let initialClient = WishlistTestClient(responses: [
            .success(.init(entries: [WishlistTestClient.luffy], nextCursor: "old-page-two"))
        ])
        await TCGWishlistScreenModel().search(using: cache.wishlist(client: initialClient))

        let gate = WishlistRequestGate()
        let client = WishlistTestClient(
            responses: [
                .success(.init(entries: [WishlistTestClient.pikachu], nextCursor: nil)),
                .success(.init(entries: [WishlistTestClient.pikachu], nextCursor: "new-page-two")),
            ],
            firstRequestGate: gate
        )
        let wishlist = cache.wishlist(client: client)
        let original = TCGWishlistScreenModel()
        await original.search(using: wishlist)
        let next = Task { await original.loadNextPage(using: wishlist) }
        await gate.waitUntilStarted()
        await TCGWishlistScreenModel().refresh(using: wishlist)
        gate.resume()
        await next.value

        let reopened = TCGWishlistScreenModel()
        await reopened.search(using: cache.wishlist(client: client))
        #expect(reopened.entries == [WishlistTestClient.pikachu])
        #expect(reopened.cursor == "new-page-two")
        #expect(await client.requests == [.init(query: nil, cursor: "old-page-two"), .init(query: nil, cursor: nil)])
    }

    @Test
    func `Removal invalidates saved queries and prevents a late page from restoring a printing`() async throws {
        let cache = WishlistCacheFixture()
        defer { try? FileManager.default.removeItem(at: cache.root) }
        let saved = Result<WishlistPage, WishlistError>.success(
            .init(entries: [WishlistTestClient.luffy], nextCursor: nil)
        )
        let client = WishlistTestClient(responses: [saved, saved])
        let wishlist = cache.wishlist(client: client)
        let model = TCGWishlistScreenModel()
        await model.refresh(using: wishlist)
        model.query = "Luffy"
        await model.refresh(using: wishlist)

        let gate = WishlistRequestGate()
        let slowClient = WishlistTestClient(responses: [saved, Self.empty], firstRequestGate: gate)
        let relaunched = cache.wishlist(client: slowClient)
        let reopened = TCGWishlistScreenModel()
        let refresh = Task { await reopened.refresh(using: relaunched) }
        await gate.waitUntilStarted()
        let key = try #require(WishlistTestClient.luffy.printingKey)
        try await relaunched.remove(printingKey: key).get()
        gate.resume()
        await refresh.value
        let unfiltered = try #require(relaunched.snapshot(for: nil))
        #expect(unfiltered.entries.isEmpty)
        #expect(unfiltered.checkedAt == nil)

        let afterRemoval = TCGWishlistScreenModel()
        afterRemoval.query = " Luffy "
        await afterRemoval.search(using: relaunched)
        #expect(afterRemoval.entries.isEmpty)
        #expect(afterRemoval.hasLoaded)
        #expect(await slowClient.requests == [.init(query: nil, cursor: nil), .init(query: "Luffy", cursor: nil)])
    }

    @Test
    func `Only a successful save invalidates a fresh list`() async throws {
        let cache = WishlistCacheFixture()
        defer { try? FileManager.default.removeItem(at: cache.root) }
        let saved = Result<WishlistPage, WishlistError>.success(
            .init(entries: [WishlistTestClient.luffy], nextCursor: nil)
        )
        let client = WishlistTestClient(responses: [Self.empty, saved], saves: [.failure(.unavailable), .success(())])
        let wishlist = cache.wishlist(client: client)
        let initial = TCGWishlistScreenModel()
        await initial.search(using: wishlist)
        await #expect(throws: WishlistError.unavailable) {
            try await wishlist.save(pricedCardID: WishlistTestClient.luffy.id).get()
        }
        let reopened = TCGWishlistScreenModel()
        await reopened.search(using: wishlist)
        #expect(reopened.entries.isEmpty)
        #expect(await client.requests.count == 1)

        try await wishlist.save(pricedCardID: WishlistTestClient.luffy.id).get()
        await reopened.search(using: wishlist)
        #expect(reopened.entries == [WishlistTestClient.luffy])
        #expect(await client.requests.count == 2)
    }

    @Test
    func `An account change discards a pending response and sign-out clears the list`() async {
        let cache = WishlistCacheFixture()
        defer { try? FileManager.default.removeItem(at: cache.root) }
        let gate = WishlistRequestGate()
        let client = WishlistTestClient(
            responses: [.success(.init(entries: [WishlistTestClient.luffy], nextCursor: nil)), Self.empty],
            firstRequestGate: gate
        )
        let wishlist = cache.wishlist(client: client)
        let first = TCGWishlistScreenModel()
        let pending = Task { await first.search(using: wishlist) }
        await gate.waitUntilStarted()
        cache.account = "second"
        let second = TCGWishlistScreenModel()
        await second.search(using: wishlist)
        gate.resume()
        await pending.value
        #expect(first.entries.isEmpty)
        #expect(second.entries.isEmpty)
        #expect(second.hasLoaded)

        cache.account = nil
        await second.search(using: wishlist)
        #expect(!second.hasLoaded)
        #expect(await client.requests.count == 2)
    }

    private static let empty: Result<WishlistPage, WishlistError> = .success(.init(entries: [], nextCursor: nil))
}

@MainActor
private final class WishlistCacheFixture {
    let root = URL.temporaryDirectory.appending(path: UUID().uuidString, directoryHint: .isDirectory)
    var now = Date(timeIntervalSince1970: 1_784_548_800)
    var account: String? = "first"

    func wishlist(client: WishlistTestClient) -> TCGWishlist {
        TCGWishlist(client: client, accountID: { self.account }, cacheRoot: root, now: { self.now })
    }
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

    static let pikachu = PricedCard(
        id: "550e8400-e29b-41d4-a716-446655440001",
        printingKey: String(repeating: "b", count: 64),
        game: .pokemon,
        name: "Pikachu",
        cardNumber: "58",
        setName: "Base Set",
        illustrator: nil,
        variantName: nil,
        pricedOn: Date(timeIntervalSince1970: 0),
        fetchedAt: Date(timeIntervalSince1970: 0)
    )

    private(set) var requests: [Request] = []
    private var responses: [Result<WishlistPage, WishlistError>]
    private let firstRequestGate: WishlistRequestGate?
    private var saves: [Result<Void, WishlistError>]

    init(
        responses: [Result<WishlistPage, WishlistError>] = [],
        firstRequestGate: WishlistRequestGate? = nil,
        saves: [Result<Void, WishlistError>] = []
    ) {
        self.responses = responses
        self.firstRequestGate = firstRequestGate
        self.saves = saves
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

    func save(_ payload: SaveWishlistPrinting) async -> Result<Void, WishlistError> {
        saves.isEmpty ? .success(()) : saves.removeFirst()
    }

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
