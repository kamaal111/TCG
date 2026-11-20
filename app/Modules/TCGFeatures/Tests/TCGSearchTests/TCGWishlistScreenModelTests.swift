import Foundation
import TCGModels
import Testing

@testable import TCGClient
@testable import TCGSearch

@MainActor
struct TCGWishlistScreenModelTests {
    @Test
    func `Discards an old search result after the game changes`() async {
        let gate = WishlistRequestGate()
        let client = WishlistTestClient(
            responses: [
                Self.page(entries: [WishlistTestClient.luffy], nextCursor: "old"), Self.empty,
            ],
            firstRequestGate: gate,
            saves: []
        )
        let wishlist = TCGWishlist(client: client, accountID: nil)
        let model = TCGWishlistScreenModel(preferences: nil)
        model.filterState.query = "  Luffy  "
        let first = Task { await model.refresh(using: wishlist, currency: nil) }
        await gate.waitUntilStarted()

        model.filterState.game = .pokemon
        await model.refresh(using: wishlist, currency: nil)
        gate.resume()
        await first.value

        #expect(
            await client.requests == [
                .init(filters: .init(game: nil, setNames: [], illustrators: [], query: "Luffy"), cursor: nil),
                .init(filters: .init(game: .pokemon, setNames: [], illustrators: [], query: "Luffy"), cursor: nil),
            ]
        )
        #expect(model.entries.isEmpty)
        #expect(model.cursor == nil)
        #expect(model.hasLoaded)
    }

    @Test
    func `Clearing search reloads the unfiltered first page`() async {
        let client = WishlistTestClient(
            responses: [
                Self.empty,
                Self.page(entries: [WishlistTestClient.luffy], nextCursor: nil),
            ],
            firstRequestGate: nil,
            saves: []
        )
        let wishlist = TCGWishlist(client: client, accountID: nil)
        let model = TCGWishlistScreenModel(preferences: nil)
        model.filterState.query = "Pikachu"
        await model.refresh(using: wishlist, currency: nil)

        model.filterState.query = " "
        await model.search(using: wishlist, currency: nil)

        #expect(
            await client.requests == [
                .init(filters: .init(game: nil, setNames: [], illustrators: [], query: "Pikachu"), cursor: nil),
                .init(filters: .unfiltered, cursor: nil),
            ]
        )
        #expect(model.entries == [WishlistTestClient.luffy])
    }

    @Test
    func `Retries a failed page with the same filters and cursor`() async {
        let client = WishlistTestClient(
            responses: [
                Self.page(entries: [WishlistTestClient.luffy], nextCursor: "next"),
                .failure(.unavailable),
                Self.empty,
            ],
            firstRequestGate: nil,
            saves: []
        )
        let wishlist = TCGWishlist(client: client, accountID: nil)
        let model = TCGWishlistScreenModel(preferences: nil)
        model.filterState.game = .onePiece
        model.filterState.setNames = ["Awakening of the New Era"]
        model.filterState.query = "  Luffy "
        await model.refresh(using: wishlist, currency: nil)
        await model.loadNextPage(using: wishlist)
        #expect(model.error == .unavailable)

        await model.retry(using: wishlist)

        let filters = CardListFilters(
            game: .onePiece,
            setNames: ["Awakening of the New Era"],
            illustrators: [],
            query: "Luffy"
        )
        #expect(
            await client.requests == [
                .init(filters: filters, cursor: nil),
                .init(filters: filters, cursor: "next"),
                .init(filters: filters, cursor: "next"),
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
            responses: [
                Self.page(entries: [WishlistTestClient.luffy], nextCursor: nil)
            ],
            firstRequestGate: gate,
            saves: []
        )
        let wishlist = TCGWishlist(client: client, accountID: nil)
        let model = TCGWishlistScreenModel(preferences: nil)
        let refresh = Task { await model.refresh(using: wishlist, currency: nil) }
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
        let original = WishlistTestClient(
            responses: [
                Self.page(entries: [WishlistTestClient.luffy], nextCursor: "page-two"),
                Self.page(entries: [WishlistTestClient.pikachu], nextCursor: "page-three"),
            ],
            firstRequestGate: nil,
            saves: []
        )
        let initial = TCGWishlistScreenModel(preferences: nil)
        let originalWishlist = cache.wishlist(client: original)
        await initial.search(using: originalWishlist, currency: nil)
        cache.now = cache.now.addingTimeInterval(60)
        await initial.loadNextPage(using: originalWishlist)
        #expect(initial.cursor == "page-three")

        let gate = WishlistRequestGate()
        let client = WishlistTestClient(
            responses: [
                Self.page(entries: [WishlistTestClient.pikachu], nextCursor: "new-page-two"),
                Self.page(entries: [WishlistTestClient.pikachu, WishlistTestClient.luffy], nextCursor: nil),
            ],
            firstRequestGate: gate,
            saves: []
        )
        let wishlist = cache.wishlist(client: client)
        let reopened = TCGWishlistScreenModel(preferences: nil)
        cache.now = cache.now.addingTimeInterval(4 * 60)
        await reopened.search(using: wishlist, currency: nil)
        #expect(reopened.entries == [WishlistTestClient.luffy, WishlistTestClient.pikachu])
        #expect(reopened.cursor == "page-three")
        #expect(await client.requests.isEmpty)

        cache.now = cache.now.addingTimeInterval(10 * 60)
        let refresh = Task { await reopened.search(using: wishlist, currency: nil) }
        await gate.waitUntilStarted()
        #expect(reopened.entries == [WishlistTestClient.luffy, WishlistTestClient.pikachu])
        gate.resume()
        await refresh.value

        #expect(
            await client.requests == [
                .init(filters: .unfiltered, cursor: nil), .init(filters: .unfiltered, cursor: "new-page-two"),
            ]
        )
        #expect(reopened.entries == [WishlistTestClient.pikachu, WishlistTestClient.luffy])
        #expect(reopened.cursor == nil)
    }

    @Test
    func `Cached searches are separate and successful empty results are fresh`() async {
        let cache = WishlistCacheFixture()
        defer { try? FileManager.default.removeItem(at: cache.root) }
        let client = WishlistTestClient(
            responses: [
                Self.page(entries: [WishlistTestClient.luffy], nextCursor: nil),
                Self.empty,
                .success(
                    .init(entries: [], nextCursor: nil, availableSetNames: ["Base Set"], availableIllustrators: [])
                ),
            ],
            firstRequestGate: nil,
            saves: []
        )
        let wishlist = cache.wishlist(client: client)
        let model = TCGWishlistScreenModel(preferences: nil)
        model.filterState.query = "Luffy"
        await model.refresh(using: wishlist, currency: nil)
        model.filterState.query = "Pikachu"
        await model.refresh(using: wishlist, currency: nil)

        let reopened = TCGWishlistScreenModel(preferences: nil)
        reopened.filterState.query = "  Luffy  "
        await reopened.search(using: wishlist, currency: nil)
        #expect(reopened.entries == [WishlistTestClient.luffy])
        reopened.filterState.query = "Pikachu"
        await reopened.search(using: wishlist, currency: nil)
        #expect(reopened.entries.isEmpty)
        #expect(reopened.hasLoaded)
        reopened.filterState.game = .pokemon
        reopened.filterState.query = "Luffy"
        await reopened.search(using: wishlist, currency: nil)
        #expect(reopened.entries.isEmpty)
        #expect(reopened.availableSetNames == ["Base Set"])

        let filtered = TCGWishlistScreenModel(preferences: nil)
        filtered.filterState.game = .pokemon
        filtered.filterState.query = "  Luffy "
        await filtered.search(using: wishlist, currency: nil)
        #expect(filtered.entries.isEmpty)
        #expect(filtered.availableSetNames == ["Base Set"])
        #expect(
            await client.requests == [
                .init(filters: .init(game: nil, setNames: [], illustrators: [], query: "Luffy"), cursor: nil),
                .init(filters: .init(game: nil, setNames: [], illustrators: [], query: "Pikachu"), cursor: nil),
                .init(filters: .init(game: .pokemon, setNames: [], illustrators: [], query: "Luffy"), cursor: nil),
            ]
        )
    }

    @Test
    func `A currency change refreshes a fresh list while retaining its rows`() async {
        let cache = WishlistCacheFixture()
        defer { try? FileManager.default.removeItem(at: cache.root) }
        let initialClient = WishlistTestClient(
            responses: [
                Self.page(entries: [WishlistTestClient.luffy], nextCursor: nil)
            ],
            firstRequestGate: nil,
            saves: []
        )
        let initial = TCGWishlistScreenModel(preferences: nil)
        await initial.search(
            using: cache.wishlist(client: initialClient),
            currency: .usd
        )

        let gate = WishlistRequestGate()
        let client = WishlistTestClient(
            responses: [
                Self.page(entries: [WishlistTestClient.pikachu], nextCursor: nil)
            ],
            firstRequestGate: gate,
            saves: []
        )
        let wishlist = cache.wishlist(client: client)
        let model = TCGWishlistScreenModel(preferences: nil)
        let reload = Task { await model.search(using: wishlist, currency: .eur) }
        await gate.waitUntilStarted()
        #expect(model.entries == [WishlistTestClient.luffy])
        gate.resume()
        await reload.value
        #expect(model.entries == [WishlistTestClient.pikachu])

        let reopened = TCGWishlistScreenModel(preferences: nil)
        await reopened.search(using: cache.wishlist(client: client), currency: .eur)
        #expect(reopened.entries == [WishlistTestClient.pikachu])
        #expect(await client.requests.count == 1)
    }

    @Test
    func `A forced refresh keeps cached rows when it fails and retries page one`() async {
        let cache = WishlistCacheFixture()
        defer { try? FileManager.default.removeItem(at: cache.root) }
        let client = WishlistTestClient(
            responses: [
                Self.page(entries: [WishlistTestClient.luffy], nextCursor: nil),
                .failure(.unavailable),
                Self.empty,
            ],
            firstRequestGate: nil,
            saves: []
        )
        let wishlist = cache.wishlist(client: client)
        let model = TCGWishlistScreenModel(preferences: nil)
        await model.search(using: wishlist, currency: nil)
        await model.refresh(using: wishlist, currency: nil)
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
        let initialClient = WishlistTestClient(
            responses: [
                Self.page(entries: [WishlistTestClient.luffy], nextCursor: "page-two")
            ],
            firstRequestGate: nil,
            saves: []
        )
        let initial = TCGWishlistScreenModel(preferences: nil)
        await initial.search(
            using: cache.wishlist(client: initialClient),
            currency: nil
        )

        let client = WishlistTestClient(
            responses: [
                Self.page(entries: [WishlistTestClient.pikachu], nextCursor: "page-two"),
                Self.page(entries: [WishlistTestClient.luffy, WishlistTestClient.pikachu], nextCursor: nil),
            ],
            firstRequestGate: nil,
            saves: []
        )
        let wishlist = cache.wishlist(client: client)
        let model = TCGWishlistScreenModel(preferences: nil)
        await model.search(using: wishlist, currency: nil)
        await model.loadNextPage(using: wishlist)
        #expect(model.entries == [WishlistTestClient.luffy])
        #expect(model.error == .unavailable)
        await model.retry(using: wishlist)
        #expect(model.entries == [WishlistTestClient.luffy, WishlistTestClient.pikachu])
        #expect(model.cursor == nil)
        #expect(
            await client.requests == [
                .init(filters: .unfiltered, cursor: "page-two"), .init(filters: .unfiltered, cursor: "page-two"),
            ]
        )
    }

    @Test
    func `A late continuation cannot replace a newer first-page snapshot`() async {
        let cache = WishlistCacheFixture()
        defer { try? FileManager.default.removeItem(at: cache.root) }
        let initialClient = WishlistTestClient(
            responses: [
                Self.page(entries: [WishlistTestClient.luffy], nextCursor: "old-page-two")
            ],
            firstRequestGate: nil,
            saves: []
        )
        let initial = TCGWishlistScreenModel(preferences: nil)
        await initial.search(
            using: cache.wishlist(client: initialClient),
            currency: nil
        )

        let gate = WishlistRequestGate()
        let client = WishlistTestClient(
            responses: [
                Self.page(entries: [WishlistTestClient.pikachu], nextCursor: nil),
                Self.page(entries: [WishlistTestClient.pikachu], nextCursor: "new-page-two"),
            ],
            firstRequestGate: gate,
            saves: []
        )
        let wishlist = cache.wishlist(client: client)
        let original = TCGWishlistScreenModel(preferences: nil)
        await original.search(using: wishlist, currency: nil)
        let next = Task { await original.loadNextPage(using: wishlist) }
        await gate.waitUntilStarted()
        await TCGWishlistScreenModel(preferences: nil).refresh(using: wishlist, currency: nil)
        gate.resume()
        await next.value

        let reopened = TCGWishlistScreenModel(preferences: nil)
        await reopened.search(using: cache.wishlist(client: client), currency: nil)
        #expect(reopened.entries == [WishlistTestClient.pikachu])
        #expect(reopened.cursor == "new-page-two")
        #expect(
            await client.requests == [
                .init(filters: .unfiltered, cursor: "old-page-two"), .init(filters: .unfiltered, cursor: nil),
            ]
        )
    }

    @Test
    func `Removal invalidates saved queries and prevents a late page from restoring a printing`() async throws {
        let cache = WishlistCacheFixture()
        defer { try? FileManager.default.removeItem(at: cache.root) }
        let saved = Self.page(entries: [WishlistTestClient.luffy], nextCursor: nil)
        let client = WishlistTestClient(responses: [saved, saved], firstRequestGate: nil, saves: [])
        let wishlist = cache.wishlist(client: client)
        let model = TCGWishlistScreenModel(preferences: nil)
        await model.refresh(using: wishlist, currency: nil)
        model.filterState.query = "Luffy"
        await model.refresh(using: wishlist, currency: nil)

        let gate = WishlistRequestGate()
        let slowClient = WishlistTestClient(responses: [saved, Self.empty], firstRequestGate: gate, saves: [])
        let relaunched = cache.wishlist(client: slowClient)
        let reopened = TCGWishlistScreenModel(preferences: nil)
        let refresh = Task { await reopened.refresh(using: relaunched, currency: nil) }
        await gate.waitUntilStarted()
        let key = try #require(WishlistTestClient.luffy.printingKey)
        try await relaunched.remove(printingKey: key).get()
        gate.resume()
        await refresh.value
        let unfiltered = try #require(relaunched.snapshot(for: .unfiltered))
        #expect(unfiltered.entries.isEmpty)
        #expect(unfiltered.checkedAt == nil)

        let afterRemoval = TCGWishlistScreenModel(preferences: nil)
        afterRemoval.filterState.query = " Luffy "
        await afterRemoval.search(using: relaunched, currency: nil)
        #expect(afterRemoval.entries.isEmpty)
        #expect(afterRemoval.hasLoaded)
        #expect(
            await slowClient.requests == [
                .init(filters: .unfiltered, cursor: nil),
                .init(filters: .init(game: nil, setNames: [], illustrators: [], query: "Luffy"), cursor: nil),
            ]
        )
    }

    @Test
    func `Only a successful save invalidates a fresh list`() async throws {
        let cache = WishlistCacheFixture()
        defer { try? FileManager.default.removeItem(at: cache.root) }
        let saved = Self.page(entries: [WishlistTestClient.luffy], nextCursor: nil)
        let client = WishlistTestClient(
            responses: [Self.empty, saved],
            firstRequestGate: nil,
            saves: [.failure(.unavailable), .success(())]
        )
        let wishlist = cache.wishlist(client: client)
        let initial = TCGWishlistScreenModel(preferences: nil)
        await initial.search(using: wishlist, currency: nil)
        await #expect(throws: WishlistError.unavailable) {
            try await wishlist.save(pricedCardID: WishlistTestClient.luffy.id).get()
        }
        let reopened = TCGWishlistScreenModel(preferences: nil)
        await reopened.search(using: wishlist, currency: nil)
        #expect(reopened.entries.isEmpty)
        #expect(await client.requests.count == 1)

        try await wishlist.save(pricedCardID: WishlistTestClient.luffy.id).get()
        await reopened.search(using: wishlist, currency: nil)
        #expect(reopened.entries == [WishlistTestClient.luffy])
        #expect(await client.requests.count == 2)
    }

    @Test
    func `An account change discards a pending response and sign-out clears the list`() async {
        let cache = WishlistCacheFixture()
        defer { try? FileManager.default.removeItem(at: cache.root) }
        let gate = WishlistRequestGate()
        let client = WishlistTestClient(
            responses: [
                Self.page(entries: [WishlistTestClient.luffy], nextCursor: nil), Self.empty,
            ],
            firstRequestGate: gate,
            saves: []
        )
        let wishlist = cache.wishlist(client: client)
        let first = TCGWishlistScreenModel(preferences: nil)
        let pending = Task { await first.search(using: wishlist, currency: nil) }
        await gate.waitUntilStarted()
        cache.account = "second"
        let second = TCGWishlistScreenModel(preferences: nil)
        await second.search(using: wishlist, currency: nil)
        gate.resume()
        await pending.value
        #expect(first.entries.isEmpty)
        #expect(second.entries.isEmpty)
        #expect(second.hasLoaded)

        cache.account = nil
        await second.search(using: wishlist, currency: nil)
        #expect(!second.hasLoaded)
        #expect(await client.requests.count == 2)
    }

    @Test
    func `Restores separate Wishlist selections and clears dependent filters on game change`() throws {
        let suite = UUID().uuidString
        let preferences = try #require(UserDefaults(suiteName: suite))
        defer { preferences.removePersistentDomain(forName: suite) }
        let owned = CardListFilterState(preferences: preferences, preferenceScope: .allCards)
        owned.game = .onePiece
        owned.setNames = ["Romance Dawn"]

        let model = TCGWishlistScreenModel(preferences: preferences)
        #expect(!model.filterState.filters.isActive)
        model.filterState.game = .pokemon
        model.filterState.setNames = ["Crown Zenith"]
        model.filterState.illustrators = ["Mitsuhiro Arita"]
        model.filterState.query = "Pikachu"

        let restored = TCGWishlistScreenModel(preferences: preferences).filterState
        #expect(restored.game == .pokemon)
        #expect(restored.setNames == ["Crown Zenith"])
        #expect(restored.illustrators == ["Mitsuhiro Arita"])
        #expect(restored.query.isEmpty)

        restored.game = .onePiece
        #expect(restored.setNames.isEmpty)
        #expect(restored.illustrators.isEmpty)
        let restoredOwned = CardListFilterState(preferences: preferences, preferenceScope: .allCards)
        #expect(restoredOwned.game == .onePiece)
        #expect(restoredOwned.setNames == ["Romance Dawn"])
    }

    private static func page(entries: [PricedCard], nextCursor: String?) -> Result<WishlistPage, WishlistError> {
        .success(.init(entries: entries, nextCursor: nextCursor, availableSetNames: [], availableIllustrators: []))
    }

    private static let empty: Result<WishlistPage, WishlistError> = Self.page(entries: [], nextCursor: nil)
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
    static let luffy = PricedCard(
        id: "550e8400-e29b-41d4-a716-446655440000",
        printingKey: String(repeating: "a", count: 64),
        isWishlisted: nil,
        game: .onePiece,
        name: "Monkey.D.Luffy",
        cardNumber: "OP05-119",
        setName: "Awakening of the New Era",
        rarity: nil,
        illustrator: nil,
        variantName: "Alternate Art",
        imageURL: nil,
        headline: nil,
        market: nil,
        display: nil,
        pricedOn: Date(timeIntervalSince1970: 0),
        fetchedAt: Date(timeIntervalSince1970: 0)
    )

    static let pikachu = PricedCard(
        id: "550e8400-e29b-41d4-a716-446655440001",
        printingKey: String(repeating: "b", count: 64),
        isWishlisted: nil,
        game: .pokemon,
        name: "Pikachu",
        cardNumber: "58",
        setName: "Base Set",
        rarity: nil,
        illustrator: nil,
        variantName: nil,
        imageURL: nil,
        headline: nil,
        market: nil,
        display: nil,
        pricedOn: Date(timeIntervalSince1970: 0),
        fetchedAt: Date(timeIntervalSince1970: 0)
    )

    private(set) var requests: [WishlistListQuery] = []
    private var responses: [Result<WishlistPage, WishlistError>]
    private let firstRequestGate: WishlistRequestGate?
    private var saves: [Result<Void, WishlistError>]

    init(
        responses: [Result<WishlistPage, WishlistError>],
        firstRequestGate: WishlistRequestGate?,
        saves: [Result<Void, WishlistError>]
    ) {
        self.responses = responses
        self.firstRequestGate = firstRequestGate
        self.saves = saves
    }

    func list(_ request: WishlistListQuery) async -> Result<WishlistPage, WishlistError> {
        requests.append(request)
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
