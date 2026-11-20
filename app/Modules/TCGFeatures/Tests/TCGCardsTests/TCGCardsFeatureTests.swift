//
//  TCGCardsFeatureTests.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/20/26.
//

import Foundation
import HTTPTypes
import KamaalAuth
import OpenAPIRuntime
import TCGCurrency
import TCGModels
import Testing

@testable import TCGCards
@testable import TCGClient

@Suite("TCGCards Feature Tests")
@MainActor
struct TCGCardsFeatureTests {
    @Test
    func `A saved binder with fresh summaries retries a missing layout without falling back to All cards`() async throws
    {
        let suite = "TCG.collections.tests.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let directory = URL.temporaryDirectory.appending(path: suite, directoryHint: .isDirectory)
        defer { try? FileManager.default.removeItem(at: directory) }
        let now = Date(timeIntervalSince1970: 1_784_548_800)
        let account = "binder@example.test"
        var binder = CollectionTestFixtures.collection()
        binder.revision = 1
        let preferences = CollectionPreferences(defaults: defaults)
        preferences.saveDestination(.named(binder.id), account: account)
        preferences.saveView(.binder, account: account, collectionID: binder.id)
        let previousCache = CollectionSnapshotCache(root: directory)
        previousCache.useAccount(account)
        previousCache.saveSummaries([binder.summary], checkedAt: now)

        let transport = PendingCollectionTransport()
        let client = makePendingClient(transport)
        let cards = TCGCards(client: client, snapshot: CollectionSnapshotCache(root: directory), now: { now })
        let collections = TCGCollections(client: client, defaults: defaults)
        collections.startSession(account: account, cards: cards, seed: ([], []))
        #expect(collections.destination == .named(binder.id))
        #expect(collections.selected == nil)
        #expect(cards.isShowingBinder)

        let layoutPath = "/app-api/collections/\(binder.id.uuidString.lowercased())"
        let failed = Task { await collections.reload(using: cards, force: false, loadsList: true) }
        await transport.waitForRequest(layoutPath)
        await transport.complete(layoutPath, status: .serviceUnavailable)
        await failed.value
        #expect(collections.destination == .named(binder.id))
        #expect(preferences.restoreDestination(account: account) == .named(binder.id))

        let retry = Task { await collections.reload(using: cards, force: false, loadsList: true) }
        await transport.waitForRequest(layoutPath)
        await transport.completeBinder(id: binder.id, page: CardsTestIDs.secondary, path: layoutPath)
        await retry.value
        #expect(collections.selected?.id == binder.id)
        #expect(cards.selectedCollection?.id == binder.id)
        #expect(await transport.requestCount == 2)
    }

    @Test func `A summaries refresh started on a binder preserves a newer system destination`() async {
        let transport = PendingCollectionTransport()
        let client = makePendingClient(transport)
        let cards = TCGCards(client: client)
        let collections = TCGCollections(client: client, defaults: nil)
        let binder = CollectionTestFixtures.collection()
        let first = Task { await collections.reload(using: cards, force: true, loadsList: false) }
        await transport.waitForRequest("/app-api/collections")
        await transport.completeCollections(id: binder.id)
        await first.value

        let path = "/app-api/collections/\(binder.id.uuidString.lowercased())"
        let named = Task { await collections.select(.named(binder.id), using: cards, loadsList: false) }
        await transport.waitForRequest(path)
        await transport.completeBinder(id: binder.id, page: CardsTestIDs.secondary, path: path)
        await named.value
        let refresh = Task { await collections.reload(using: cards, force: true, loadsList: false) }
        await transport.waitForRequest("/app-api/collections")
        await collections.select(.system(.wishlist), using: cards, loadsList: false)
        await transport.completeCollections(id: binder.id)
        await refresh.value
        #expect(collections.destination == .system(.wishlist))
        #expect(collections.selectedID == nil)
        #expect(cards.selectedCollection == nil)
    }

    @Test
    func `Searches again after a collection page supplies an alias for a cached empty search`() async throws {
        let transport = PendingCollectionTransport()
        let now = Date(timeIntervalSince1970: 1_784_548_800)
        let feature = makePendingFeature(transport, now: { now })
        let snapshot = feature.snapshot
        let searchScope = CollectionSnapshotCache.Scope(query: "Shiftry")
        snapshot.saveRead(
            [],
            for: searchScope,
            checkedAt: now,
            list: .init(
                nextCursor: nil,
                visitedCursors: [],
                pageCount: 1,
                sets: [],
                illustrators: [],
                requiresPricing: false
            )
        )
        let listPath = "/app-api/cards"
        let load = Task { await feature.load(game: nil, setNames: [], query: nil, illustrators: []) }
        await transport.waitForRequest(listPath)
        await transport.completeShiftryPage(listPath)
        try await load.value.get()
        try #require(snapshot.freshPage(for: searchScope, at: now) == nil)

        let searchPath = "/app-api/cards?query=Shiftry"
        let search = Task { await feature.load(game: nil, setNames: [], query: "Shiftry", illustrators: []) }
        await transport.waitForRequest(searchPath)
        await transport.completeShiftryPage(searchPath)
        try await search.value.get()
        #expect(feature.cards.map(\.card.name) == ["ダーテング"])
    }

    @Test
    func `Restores owned cards before details and applies price updates independently`() async throws {
        let directory = URL.temporaryDirectory.appending(path: UUID().uuidString, directoryHint: .isDirectory)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = CollectionSnapshotCache(root: directory)
        let account = "cache@example.test"
        store.useAccount(account)
        let cached = try #require(PreviewTCGCardsClient.sampleCards.first)
        store.save([CardWithPrice(card: cached, price: .init(cardId: cached.id, status: .noPrice))], for: .allCards)

        let transport = PendingCollectionTransport(holdPrices: true)
        let feature = makePendingFeature(transport, snapshot: CollectionSnapshotCache(root: directory))
        feature.useAccount(account)
        let load = Task { await feature.load(game: nil, setNames: [], query: nil, illustrators: []) }
        await transport.waitForRequest("/app-api/cards")
        #expect(feature.cards.map(\.card.id) == [cached.id])

        await transport.completePage("/app-api/cards", id: CardsTestIDs.cachedPokemon, cursor: nil)
        try await load.value.get()
        await transport.waitForRequest("/app-api/cards/prices")
        #expect(feature.cards.map(\.card.id) == [CardsTestIDs.cachedPokemon])
        #expect(feature.isLoadingPrices)
        await transport.completePrice(id: CardsTestIDs.cachedPokemon)
        let deadline = ContinuousClock.now.advanced(by: .seconds(5))
        while feature.isLoadingPrices, ContinuousClock.now < deadline { await Task.yield() }
        #expect(!feature.isLoadingPrices)
        #expect(feature.cards.first?.price.status == .noPrice)
        #expect(feature.cards.first?.card.name == "Pikachu")

        feature.useAccount("other@example.test")
        #expect(feature.cards.isEmpty)
        #expect(feature.snapshot.rows(for: .allCards) == nil)
        feature.useAccount(account)
        #expect(feature.snapshot.rows(for: .allCards)?.first?.price.status == .noPrice)
    }

    @Test
    func `Only a confirmed deletion evicts a cached detail`() async throws {
        let transport = PendingCollectionTransport()
        let feature = makePendingFeature(transport)
        let sample = try #require(PreviewTCGCardsClient.sampleCards.first)
        let cached = CardWithPrice(card: sample, price: .init(cardId: sample.id, status: .noPrice))
        let path = "/app-api/cards/\(sample.id.uuidString.lowercased())"
        feature.snapshot.save([cached], for: .allCards)
        feature.restoreCollection(nil)

        let unavailable = Task { await feature.validateCard(cached) }
        await transport.waitForRequest(path)
        await transport.complete(path, status: .serviceUnavailable)
        #expect(await unavailable.value == .failure(.unavailable))
        #expect(feature.cards == [cached])

        let deleted = Task { await feature.validateCard(cached) }
        await transport.waitForRequest(path)
        await transport.completeCardNotFound(path)
        #expect(await deleted.value == .failure(.notFound))
        #expect(feature.cards.isEmpty)
        #expect(feature.snapshot.rows(for: .allCards)?.isEmpty == true)
    }

    @Test
    func `Changing currency does not restart a delayed collection read`() async throws {
        let transport = PendingCollectionTransport()
        let feature = makePendingFeature(transport)
        let currency = TCGCurrency(client: .preview(), defaults: nil)
        await feature.refreshDisplayPrices(for: currency.displayIdentity, refreshVisible: true)
        let original = Task { await feature.load(game: nil, setNames: [], query: nil, illustrators: []) }
        await transport.waitForRequest("/app-api/cards")
        #expect(await currency.save(.eur))
        await feature.refreshDisplayPrices(for: currency.displayIdentity, refreshVisible: true)
        #expect(await transport.requestCount == 1)
        #expect(feature.isLoading)

        await transport.completePage("/app-api/cards", id: CardsTestIDs.oldCurrencyCard, cursor: nil)
        try await original.value.get()
        #expect(feature.cards.map(\.card.id) == [CardsTestIDs.oldCurrencyCard])
        #expect(feature.displayRefreshError == nil)
    }

    @Test
    func `Automatic list and detail reads use the fifteen minute window and manual refresh bypasses it`() async throws {
        let start = Date(timeIntervalSince1970: 1_784_548_800)
        let clock = CollectionTestClock(now: start)
        let transport = PendingCollectionTransport()
        let feature = makePendingFeature(transport, now: { clock.now })
        let list = "/app-api/cards"
        let id = CardsTestIDs.cachedPokemon
        let initial = Task { await feature.load(game: nil, setNames: [], query: nil, illustrators: []) }
        await transport.waitForRequest(list)
        await transport.completePage(list, id: id, cursor: nil)
        try await initial.value.get()
        let verified = try #require(feature.cards.first)

        clock.now = start.addingTimeInterval(14 * 60)
        await feature.refresh(force: false)
        _ = try await feature.validateCard(verified).get()
        #expect(await transport.requestCount == 1)

        clock.now = start.addingTimeInterval(15 * 60)
        let detail = Task { await feature.validateCard(verified) }
        let detailPath = "\(list)/\(id.uuidString.lowercased())"
        await transport.waitForRequest(detailPath)
        await transport.complete(detailPath, status: .serviceUnavailable)
        #expect(await detail.value == .failure(.unavailable))

        let expired = Task { await feature.refresh(force: false) }
        await transport.waitForRequest(list)
        await transport.completePage(list, id: id, cursor: nil)
        await expired.value
        #expect(await transport.requestCount == 3)

        clock.now = start.addingTimeInterval(20 * 60)
        let manual = Task { await feature.refresh(force: true) }
        await transport.waitForRequest(list)
        await transport.completePage(list, id: id, cursor: nil)
        await manual.value
        #expect(await transport.requestCount == 4)
    }

    @Test
    func `Price requests share in-flight work, persist no-match, and refresh after midnight UTC`() async throws {
        let midnight = Date(timeIntervalSince1970: 86_400 * 20_000)
        let clock = CollectionTestClock(now: midnight.addingTimeInterval(-60))
        let directory = URL.temporaryDirectory.appending(path: UUID().uuidString, directoryHint: .isDirectory)
        defer { try? FileManager.default.removeItem(at: directory) }
        let transport = PendingCollectionTransport(holdPrices: true)
        let feature = makePendingFeature(
            transport,
            snapshot: CollectionSnapshotCache(root: directory),
            now: { clock.now }
        )
        feature.useAccount("prices@example.test")
        let entry = try #require(PreviewTCGCardsClient.sampleCards.first)
        let row = CardWithPrice(card: entry, price: .init(cardId: entry.id, status: .pending))
        let path = "/app-api/cards/prices"
        let first = Task { await feature.refreshedPrices(for: [row], currency: nil, retry: false) }
        await transport.waitForRequest(path)
        let duplicate = Task { await feature.refreshedPrices(for: [row], currency: nil, retry: false) }
        await transport.completePrice(id: entry.id, updatedAt: entry.updatedAt, status: .noMatch)
        let priced = await first.value
        try #require(priced.first?.price.status == .noMatch)
        #expect(await duplicate.value.first?.price.status == .noMatch)
        #expect(await transport.requestCount == 1)

        let relaunched = makePendingFeature(
            transport,
            snapshot: CollectionSnapshotCache(root: directory),
            now: { clock.now }
        )
        relaunched.useAccount("prices@example.test")
        #expect(
            await relaunched.refreshedPrices(for: [row], currency: nil, retry: false).first?.price.status == .noMatch
        )
        #expect(await transport.requestCount == 1)

        clock.now = midnight
        let nextDay = Task { await relaunched.refreshedPrices(for: [row], currency: nil, retry: false) }
        await transport.waitForRequest(path)
        await transport.completePrice(id: entry.id, updatedAt: entry.updatedAt)
        #expect(await nextDay.value.first?.price.status == .noPrice)
        #expect(await transport.requestCount == 2)
    }

    @Test
    func `Restores two fresh All Cards pages from disk and resumes at page three`() async throws {
        let directory = URL.temporaryDirectory.appending(path: UUID().uuidString, directoryHint: .isDirectory)
        defer { try? FileManager.default.removeItem(at: directory) }
        let clock = CollectionTestClock(now: Date(timeIntervalSince1970: 1_784_548_800))
        let transport = PendingCollectionTransport()
        let initial = makePendingFeature(
            transport,
            snapshot: CollectionSnapshotCache(root: directory),
            now: { clock.now }
        )
        initial.useAccount("pages@example.test")
        let list = "/app-api/cards"
        let first = Task { await initial.load(game: nil, setNames: [], query: nil, illustrators: []) }
        await transport.waitForRequest(list)
        await transport.completePage(list, id: CardsTestIDs.firstPageCard, cursor: "page-two")
        try await first.value.get()
        let second = Task { await initial.loadNextPage() }
        await transport.waitForRequest("\(list)?cursor=page-two")
        await transport.completePage("\(list)?cursor=page-two", id: CardsTestIDs.secondPageCard, cursor: "page-three")
        try await second.value.get()

        clock.now = clock.now.addingTimeInterval(5 * 60)
        let reopened = makePendingFeature(
            transport,
            snapshot: CollectionSnapshotCache(root: directory),
            now: { clock.now }
        )
        reopened.useAccount("pages@example.test")
        try await reopened.load(game: nil, setNames: [], query: nil, illustrators: []).get()
        #expect(reopened.cards.map(\.card.id) == [CardsTestIDs.firstPageCard, CardsTestIDs.secondPageCard])
        #expect(await transport.requestCount == 2)
        let third = Task { await reopened.loadNextPage() }
        await transport.waitForRequest("\(list)?cursor=page-three")
        await transport.completePage("\(list)?cursor=page-three", id: CardsTestIDs.loadedCard, cursor: nil)
        try await third.value.get()
        #expect(
            reopened.cards.map(\.card.id) == [
                CardsTestIDs.firstPageCard, CardsTestIDs.secondPageCard, CardsTestIDs.loadedCard,
            ]
        )
        #expect(!reopened.hasMoreCards)
    }

    @Test
    func `Pagination requests prices only for newly loaded cards`() async throws {
        let transport = PendingCollectionTransport(holdPrices: true)
        let feature = makePendingFeature(transport)
        let list = "/app-api/cards"
        let prices = "\(list)/prices"
        let firstID = CardsTestIDs.firstPageCard
        let secondID = CardsTestIDs.secondPageCard
        let initial = Task { await feature.load(game: nil, setNames: [], query: nil, illustrators: []) }
        await transport.waitForRequest(list)
        await transport.completePage(list, id: firstID, cursor: "next")
        try await initial.value.get()
        await transport.waitForRequest(prices)

        let next = Task { await feature.loadNextPage() }
        await transport.waitForRequest("\(list)?cursor=next")
        await transport.completePage("\(list)?cursor=next", id: secondID, cursor: nil)
        try await next.value.get()
        await transport.waitForRequests(prices, count: 2)
        #expect(await transport.priceIDs == [[firstID], [secondID]])
        await transport.completePrice(id: firstID)
        await transport.completePrice(id: secondID)
        let deadline = ContinuousClock.now.advanced(by: .seconds(5))
        while feature.isLoadingPrices, ContinuousClock.now < deadline { await Task.yield() }
        #expect(feature.cards.map(\.price.status) == [.noPrice, .noPrice])
    }

    @Test
    func `Partial pricing success caches the returned card and retries only the omitted card`() async throws {
        let clock = CollectionTestClock(now: Date(timeIntervalSince1970: 86_400 * 20_000))
        let transport = PendingCollectionTransport(holdPrices: true)
        let feature = makePendingFeature(transport, now: { clock.now })
        let entries = PreviewTCGCardsClient.sampleCards
        let pikachu = try #require(entries.first)
        let eevee = try #require(entries.last)
        let rows = [pikachu, eevee].map { CardWithPrice(card: $0, price: .init(cardId: $0.id, status: .pending)) }
        let path = "/app-api/cards/prices"
        let first = Task { await feature.refreshedPrices(for: rows, currency: nil, retry: false) }
        await transport.waitForRequest(path)
        await transport.completePrice(id: pikachu.id, updatedAt: pikachu.updatedAt)
        let partial = await first.value
        #expect(partial.map(\.price.status) == [.noPrice, .pending])

        clock.now = clock.now.addingTimeInterval(60)
        let retry = Task { await feature.refreshedPrices(for: rows, currency: nil, retry: false) }
        await transport.waitForRequest(path)
        let sent = await transport.priceIDs
        #expect(sent.map(Set.init) == [Set([pikachu.id, eevee.id]), Set([eevee.id])])
        await transport.completePrice(id: eevee.id, updatedAt: eevee.updatedAt)
        let completed = await retry.value
        #expect(completed.map(\.price.status) == [.noPrice, .noPrice])
    }

    @Test
    func `Manual refresh checks an unchanged binder page once and skips the hidden list`() async throws {
        let transport = PendingCollectionTransport()
        let client = makePendingClient(transport)
        let feature = TCGCards(client: client)
        let collections = TCGCollections(client: client, defaults: nil)
        let binder = CardsTestIDs.primary
        let page = CardsTestIDs.secondary
        let summaries = "/app-api/collections"
        let layout = "\(summaries)/\(binder.uuidString.lowercased())"
        let pagePath = "\(layout)/pages/\(page.uuidString.lowercased())"

        let load = Task { await collections.reload(using: feature, force: true, loadsList: false) }
        await transport.waitForRequest(summaries)
        await transport.completeCollections(id: binder)
        await load.value
        collections.setView(.binder, for: binder)
        let select = Task { await collections.select(.named(binder), using: feature, loadsList: true) }
        await transport.waitForRequest(layout)
        await transport.completeBinder(id: binder, page: page, path: layout)
        await select.value

        let initial = Task { await collections.page(page, using: feature, force: false) }
        await transport.waitForRequest(pagePath)
        await transport.completeBinderPage(pagePath)
        #expect(try await initial.value.get().cards.isEmpty)
        #expect(try await collections.page(page, using: feature, force: false).get().cards.isEmpty)
        #expect(await transport.requestCount == 3)

        let refreshID = collections.binderRefreshID
        let refresh = Task { await collections.refresh(using: feature, force: true) }
        await transport.waitForRequest(summaries)
        await transport.completeCollections(id: binder)
        await refresh.value
        #expect(collections.binderRefreshID != refreshID)

        let forcedPage = Task { await collections.page(page, using: feature, force: true) }
        await transport.waitForRequest(pagePath)
        await transport.completeBinderPage(pagePath)
        #expect(try await forcedPage.value.get().cards.isEmpty)
        #expect(await transport.requestCount == 5)
    }

    @Test
    func `Automatic price retries wait a minute and explicit refresh bypasses the cooldown`() async throws {
        let clock = CollectionTestClock(now: Date(timeIntervalSince1970: 86_400 * 20_000))
        let transport = PendingCollectionTransport(holdPrices: true)
        let feature = makePendingFeature(transport, now: { clock.now })
        let entry = try #require(PreviewTCGCardsClient.sampleCards.first)
        let row = CardWithPrice(card: entry, price: .init(cardId: entry.id, status: .pending))
        let path = "/app-api/cards/prices"
        let first = Task { await feature.refreshedPrices(for: [row], currency: nil, retry: false) }
        await transport.waitForRequest(path)
        await transport.complete(path, status: .serviceUnavailable)
        #expect(await first.value == [row])

        clock.now = clock.now.addingTimeInterval(59)
        #expect(await feature.refreshedPrices(for: [row], currency: nil, retry: false) == [row])
        #expect(await transport.requestCount == 1)
        let retry = Task { await feature.refreshedPrices(for: [row], currency: nil, retry: true) }
        await transport.waitForRequest(path)
        await transport.completePrice(id: entry.id, updatedAt: entry.updatedAt)
        #expect(await retry.value.first?.price.status == .noPrice)
        #expect(await transport.requestCount == 2)
    }

    @Test(arguments: [false, true])
    func `A failed filter load retains only matching cached rows`(changeGame: Bool) async throws {
        let transport = PendingCollectionTransport()
        let feature = makePendingFeature(transport)
        let initialLoad = Task { await feature.load(game: nil, setNames: [], query: nil, illustrators: []) }
        await transport.waitForRequest("/app-api/cards")
        await transport.completeWithCachedCards("/app-api/cards")
        try await initialLoad.value.get()
        #expect(feature.cards.count == 2)

        let filteredLoad = Task {
            await feature.load(
                game: changeGame ? .pokemon : nil,
                setNames: changeGame ? [] : ["Base Set"],
                query: nil,
                illustrators: []
            )
        }
        let path = changeGame ? "/app-api/cards?game=pokemon" : "/app-api/cards?set_name=Base%20Set"
        await transport.waitForRequest(path)
        #expect(feature.cards.map(\.card.id) == [CardsTestIDs.cachedPokemon])
        #expect(feature.availableSetNames == (changeGame ? [] : ["Base Set", "Romance Dawn"]))
        await transport.complete(path, status: .serviceUnavailable)
        await #expect(throws: TCGCardsOperationError.serverUnavailable) { try await filteredLoad.value.get() }
        #expect(feature.cards.map(\.card.id) == [CardsTestIDs.cachedPokemon])
        #expect(feature.availableSetNames == (changeGame ? [] : ["Base Set", "Romance Dawn"]))
        #expect(!feature.hasLoadedCurrentCollection)
        #expect(!feature.isLoading)
    }

    @Test(arguments: [
        (
            [
                CardsTestIDs.cachedPokemon,
                CardsTestIDs.cachedOnePiece,
            ], [], []
        ),
        (
            [CardsTestIDs.cachedPokemon],
            [CardsTestIDs.cachedOnePiece], [TCGCardsOperationError.notFound]
        ),
    ])
    func `Batch deletion uses one request and refreshes once`(scenario: ([UUID], [UUID], [TCGCardsOperationError]))
        async throws
    {
        let (deletedIDs, notFoundIDs, expectedErrors) = scenario
        let transport = PendingCollectionTransport()
        let feature = makePendingFeature(transport)
        let initialLoad = Task {
            await feature.load(game: .pokemon, setNames: ["Base Set"], query: nil, illustrators: [])
        }
        let listPath = "/app-api/cards?game=pokemon&set_name=Base%20Set"
        await transport.waitForRequest(listPath)
        await transport.completeWithCachedCards(listPath)
        try await initialLoad.value.get()

        let deletion = Task {
            await feature.deleteCards(ids: [
                CardsTestIDs.cachedPokemon,
                CardsTestIDs.cachedOnePiece,
            ])
        }
        await transport.waitForRequest("/app-api/cards")
        #expect(await transport.requestCount == 2)
        try await transport.completeDeletion(deletedIDs: deletedIDs, notFoundIDs: notFoundIDs)
        await transport.waitForRequest(listPath)
        #expect(feature.cards.isEmpty)
        await transport.complete(listPath, setName: "Remaining Set")
        #expect(await deletion.value == expectedErrors)
        #expect(await transport.requestCount == 3)
        #expect(feature.availableSetNames == ["Remaining Set"])
        #expect(feature.hasLoadedCurrentCollection)
    }

    @Test
    func `Empty deletion sends no requests`() async {
        let transport = PendingCollectionTransport()
        let feature = makePendingFeature(transport)
        #expect(await feature.deleteCards(ids: []).isEmpty)
        #expect(await transport.requestCount == 0)
    }

    @Test
    func `Missing deletion targets preserve cached rows without refreshing`() async throws {
        let transport = PendingCollectionTransport()
        let feature = try await loadCards(transport, response: .cached).get()
        let cached = feature.cards
        let deletion = Task {
            await feature.deleteCards(ids: [
                CardsTestIDs.third,
                CardsTestIDs.third,
            ])
        }
        await transport.waitForRequest("/app-api/cards")
        try await transport.completeDeletion(
            deletedIDs: [],
            notFoundIDs: [CardsTestIDs.third]
        )
        #expect(await deletion.value == [.notFound])
        #expect(feature.cards == cached)
        #expect(feature.hasLoadedCurrentCollection)
        #expect(await transport.requestCount == 2)
    }

    @Test
    func `Failed deletion requests preserve cached rows without refreshing`() async throws {
        let transport = PendingCollectionTransport()
        let feature = try await loadCards(transport, response: .cached).get()
        let cached = feature.cards
        let deletion = Task {
            await feature.deleteCards(ids: [CardsTestIDs.cachedPokemon])
        }
        await transport.waitForRequest("/app-api/cards")
        await transport.complete("/app-api/cards", status: .internalServerError)
        #expect(await deletion.value == [.serverUnavailable])
        #expect(feature.cards == cached)
        #expect(feature.hasLoadedCurrentCollection)
        #expect(await transport.requestCount == 2)
    }

    @Test
    func `A failed deletion refresh retains successful deletion and retries on resume`() async throws {
        let transport = PendingCollectionTransport()
        let feature = makePendingFeature(transport)
        let model = TCGCardsListScreenModel(preferences: nil)
        let load = Task { await model.load(using: feature) }
        await transport.waitForRequest("/app-api/cards")
        await transport.completeWithCachedCards("/app-api/cards")
        await load.value
        let deletion = Task {
            await feature.deleteCards(ids: [CardsTestIDs.cachedPokemon])
        }
        await transport.waitForRequest("/app-api/cards")
        try await transport.completeDeletion(
            deletedIDs: [CardsTestIDs.cachedPokemon],
            notFoundIDs: []
        )
        await transport.waitForRequest("/app-api/cards")
        await transport.complete("/app-api/cards", status: .serviceUnavailable)
        #expect(await deletion.value.isEmpty)
        #expect(feature.cards.map(\.card.id) == [CardsTestIDs.cachedOnePiece])
        #expect(!feature.hasLoadedCurrentCollection)
        let resumed = Task { await model.resumeLoadIfNeeded(using: feature) }
        await transport.waitForRequest("/app-api/cards")
        await transport.complete("/app-api/cards", setName: "Remaining Set")
        await resumed.value
        #expect(feature.hasLoadedCurrentCollection)
        #expect(await transport.requestCount == 4)
    }

    @Test
    func `A missing single deletion preserves cached rows and returns not found`() async throws {
        let transport = PendingCollectionTransport()
        let feature = try await loadCards(transport, response: .cached).get()
        let cached = feature.cards
        let deletion = Task {
            await feature.deleteCard(id: CardsTestIDs.cachedPokemon)
        }
        await transport.waitForRequest("/app-api/cards")
        try await transport.completeDeletion(
            deletedIDs: [],
            notFoundIDs: [CardsTestIDs.cachedPokemon]
        )
        await #expect(throws: TCGCardsOperationError.notFound) { try await deletion.value.get() }
        #expect(feature.cards == cached)
        #expect(feature.hasLoadedCurrentCollection)
        #expect(await transport.requestCount == 2)
        #expect(await transport.deletionIDs == [[CardsTestIDs.cachedPokemon]])
    }

    @Test
    func `A failed mutation refresh retries when the loaded screen resumes`() async throws {
        let transport = PendingCollectionTransport()
        let feature = makePendingFeature(transport)
        let model = TCGCardsListScreenModel(preferences: nil)
        let initialLoad = Task { await model.load(using: feature) }
        await transport.waitForRequest("/app-api/cards")
        await transport.complete("/app-api/cards", setName: "Base Set")
        await initialLoad.value

        let deletion = Task {
            await feature.deleteCard(id: CardsTestIDs.createdCard)
        }
        await transport.waitForRequest("/app-api/cards")
        try await transport.completeDeletion(
            deletedIDs: [CardsTestIDs.createdCard],
            notFoundIDs: []
        )
        #expect(await transport.deletionIDs == [[CardsTestIDs.createdCard]])
        await transport.waitForRequest("/app-api/cards")
        await transport.complete("/app-api/cards", status: .serviceUnavailable)
        try await deletion.value.get()
        #expect(feature.availableSetNames == ["Base Set"])
        #expect(!feature.hasLoadedCurrentCollection)

        let resumedLoad = Task { await model.resumeLoadIfNeeded(using: feature) }
        await transport.waitForRequest("/app-api/cards")
        await transport.complete("/app-api/cards", setName: "Remaining Set")
        await resumedLoad.value
        #expect(feature.availableSetNames == ["Remaining Set"])
        #expect(feature.hasLoadedCurrentCollection)
        #expect(await transport.requestCount == 4)
        await model.resumeLoadIfNeeded(using: feature)
        #expect(await transport.requestCount == 4)
    }

    @Test
    func `A cancelled initial load remains retryable when the screen resumes`() async {
        let transport = PendingCollectionTransport()
        let feature = makePendingFeature(transport)
        let model = TCGCardsListScreenModel(preferences: nil)
        let cancelledLoad = Task { await model.load(using: feature) }
        await transport.waitForRequest("/app-api/cards")
        cancelledLoad.cancel()
        await transport.complete("/app-api/cards", setName: "Base Set")
        await cancelledLoad.value
        #expect(feature.availableSetNames.isEmpty)
        #expect(!feature.isLoading)

        let resumedLoad = Task { await model.resumeLoadIfNeeded(using: feature) }
        await transport.waitForRequest("/app-api/cards")
        await transport.complete("/app-api/cards", setName: "Base Set")
        await resumedLoad.value

        #expect(await transport.requestCount == 2)
        #expect(feature.availableSetNames == ["Base Set"])
    }

    @Test
    func `Resuming a preloaded screen skips the duplicate request and still reloads changed sets`() async {
        let transport = PendingCollectionTransport()
        let feature = makePendingFeature(transport)
        let model = TCGCardsListScreenModel(preferences: nil)
        let initialLoad = Task { await model.load(using: feature) }
        await transport.waitForRequest("/app-api/cards")
        await transport.complete("/app-api/cards", setName: "Base Set")
        await initialLoad.value

        await model.resumeLoadIfNeeded(using: feature)
        #expect(await transport.requestCount == 1)
        #expect(!feature.isLoading)

        model.filterState.setNames = ["Base Set"]
        let changedLoad = Task { await model.resumeLoadIfNeeded(using: feature) }
        await transport.waitForRequest("/app-api/cards?set_name=Base%20Set")
        await transport.complete("/app-api/cards?set_name=Base%20Set", setName: "Base Set")
        await changedLoad.value

        #expect(await transport.requestCount == 2)
        #expect(feature.availableSetNames == ["Base Set"])
    }

    @Test
    func `A superseded load cannot replace a newer collection`() async throws {
        let transport = PendingCollectionTransport()
        let feature = makePendingFeature(transport)
        let oldLoad = Task { await feature.load(game: .pokemon, setNames: [], query: nil, illustrators: []) }
        await transport.waitForRequest("/app-api/cards?game=pokemon")
        let newLoad = Task { await feature.load(game: .onePiece, setNames: [], query: nil, illustrators: []) }
        await transport.waitForRequest("/app-api/cards?game=one_piece")

        await transport.complete("/app-api/cards?game=one_piece", setName: "Romance Dawn")
        try await newLoad.value.get()
        #expect(feature.availableSetNames == ["Romance Dawn"])
        #expect(!feature.isLoading)

        await transport.complete("/app-api/cards?game=pokemon", setName: "Base Set")
        try await oldLoad.value.get()
        #expect(feature.availableSetNames == ["Romance Dawn"])
        #expect(!feature.isLoading)
    }

    @Test
    func `A superseded response cannot dismiss the current loading indicator`() async throws {
        let transport = PendingCollectionTransport()
        let feature = makePendingFeature(transport)
        let oldLoad = Task { await feature.load(game: .pokemon, setNames: [], query: nil, illustrators: []) }
        await transport.waitForRequest("/app-api/cards?game=pokemon")
        let newLoad = Task { await feature.load(game: .onePiece, setNames: [], query: nil, illustrators: []) }
        await transport.waitForRequest("/app-api/cards?game=one_piece")

        await transport.complete("/app-api/cards?game=pokemon", setName: "Base Set")
        try await oldLoad.value.get()
        #expect(feature.availableSetNames.isEmpty)
        #expect(feature.isLoading)

        await transport.complete("/app-api/cards?game=one_piece", setName: "Romance Dawn")
        try await newLoad.value.get()
        #expect(feature.availableSetNames == ["Romance Dawn"])
        #expect(!feature.isLoading)
    }

    @Test
    func `Load populates cards with prices`() async throws {
        let feature = makeFeature(.success(cards: PreviewTCGCardsClient.sampleCards))
        try await feature.load(game: nil, setNames: [], query: nil, illustrators: [])
            .get()
        #expect(feature.cards.map(\.card) == PreviewTCGCardsClient.sampleCards)
        #expect(feature.cards.map(\.price) == PreviewTCGCardsClient.sampleCards.map(PreviewTCGCardsClient.price))
    }

    @Test
    func `Empty load clears cards`() async throws {
        let feature = makeFeature(.empty)
        try await feature.load(game: nil, setNames: [], query: nil, illustrators: [])
            .get()
        #expect(feature.cards.isEmpty)
    }

    @Test
    func `Load requests cards and prices for the selected game`() async throws {
        let feature = makeFeature(.success(cards: PreviewTCGCardsClient.sampleCards))

        try await feature.load(game: .pokemon, setNames: [], query: nil, illustrators: [])
            .get()

        #expect(feature.cards.map(\.card.id) == [CardsTestIDs.secondary])
        #expect(feature.cards.map(\.price.cardId) == [CardsTestIDs.secondary])
    }

    @Test
    func `Add update and delete mutate the collection`() async throws {
        let feature = makeFeature(.empty)
        try await feature.addCard(.init(pricedCardID: CardsTestIDs.addPrintingID, ownership: validValues.payload)).get()
        let cardWithPrice = try #require(feature.cards.first)
        var updated = validValues
        updated.notes = "Updated"
        _ = try await feature.updateCard(id: cardWithPrice.card.id, values: updated).get()
        #expect(feature.cards.first?.card.notes == "Updated")
        try await feature.deleteCard(id: cardWithPrice.card.id).get()
        #expect(feature.cards.isEmpty)
    }

    @Test
    func `Adding a card fetches and merges only that card's price`() async throws {
        let feature = makeFeature(.empty)

        try await feature.addCard(.init(pricedCardID: CardsTestIDs.addPrintingID, ownership: validValues.payload)).get()
        let card = try #require(feature.cards.first)

        #expect(feature.cards.map(\.card.id) == [card.card.id])
        #expect(card.price == PreviewTCGCardsClient.price(for: card.card))
    }

    @Test
    func `Updating a card merges its refreshed price without clearing other prices`() async throws {
        let feature = makeFeature(.success(cards: PreviewTCGCardsClient.sampleCards))
        try await feature.load(game: nil, setNames: [], query: nil, illustrators: [])
            .get()
        let otherCardId = try #require(
            PreviewTCGCardsClient.sampleCards.first {
                $0.id != CardsTestIDs.primary
            }?.id
        )
        let priceBeforeUpdate = feature.cards.first { $0.card.id == otherCardId }?.price

        var updated = validValues
        updated.notes = "Updated"
        _ = try await feature.updateCard(
            id: CardsTestIDs.primary,
            values: updated
        )
        .get()

        #expect(
            feature.cards.first { $0.card.id == CardsTestIDs.primary }?.price
                != nil
        )
        #expect(feature.cards.first { $0.card.id == otherCardId }?.price == priceBeforeUpdate)
    }

    @Test
    func `Load returns a cards failure`() async {
        let feature = makeFeature(.serverUnavailable)
        await #expect(throws: TCGCardsOperationError.serverUnavailable) {
            try await feature.load(game: nil, setNames: [], query: nil, illustrators: [])
                .get()
        }
    }

    @Test
    func `Pricing stays attached to its card`() async throws {
        let feature = makeFeature(.success(cards: PreviewTCGCardsClient.sampleCards))

        try await feature.load(game: nil, setNames: [], query: nil, illustrators: [])
            .get()

        #expect(feature.cards.allSatisfy { $0.card.id == $0.price.cardId })
    }

    @Test
    func `Missing update fails`() async {
        let feature = makeFeature(.notFound)
        await #expect(throws: TCGCardsOperationError.notFound) {
            try await feature.updateCard(
                id: CardsTestIDs.primary,
                values: validValues
            )
            .get()
        }
    }

    private func makeFeature(_ outcome: PreviewTCGCardsOutcome) -> TCGCards {
        TCGCards(client: .preview(cardsOutcome: outcome))
    }

    @Test
    func `Collection fetches only the first page and serializes subsequent loads`() async throws {
        let transport = PendingCollectionTransport()
        let feature = try await loadCards(transport, response: .paginated).get()
        #expect(feature.cards.map(\.card.id) == [CardsTestIDs.firstPageCard])
        #expect(feature.hasMoreCards)
        #expect(await transport.requestCount == 1)

        let next = Task { await feature.loadNextPage() }
        await transport.waitForRequest("/app-api/cards?cursor=page-two")
        #expect(feature.isLoadingNextPage)
        try await feature.loadNextPage().get()
        #expect(await transport.requestCount == 2)
        await transport.completePage(
            "/app-api/cards?cursor=page-two",
            id: CardsTestIDs.secondPageCard,
            cursor: nil
        )
        try await next.value.get()
        #expect(
            feature.cards.map(\.card.id) == [
                CardsTestIDs.firstPageCard,
                CardsTestIDs.secondPageCard,
            ]
        )
        #expect(feature.availableSetNames == ["Base Set", "Crown Zenith"])
        #expect(!feature.hasMoreCards)
        #expect(!feature.isLoadingNextPage)
    }

    @Test
    func `A failed subsequent page preserves rows and retries the same cursor`() async throws {
        let transport = PendingCollectionTransport()
        let feature = try await loadCards(transport, response: .paginated).get()

        let next = Task { await feature.loadNextPage() }
        await transport.waitForRequest("/app-api/cards?cursor=page-two")
        await transport.complete("/app-api/cards?cursor=page-two", status: .serviceUnavailable)
        await #expect(throws: TCGCardsOperationError.serverUnavailable) { try await next.value.get() }
        #expect(feature.nextPageError == .serverUnavailable)
        #expect(feature.cards.map(\.card.id) == [CardsTestIDs.firstPageCard])
        #expect(feature.hasMoreCards)
        #expect(!feature.isLoadingNextPage)

        let retry = Task { await feature.loadNextPage() }
        await transport.waitForRequest("/app-api/cards?cursor=page-two")
        await transport.completePage(
            "/app-api/cards?cursor=page-two",
            id: CardsTestIDs.secondPageCard,
            cursor: nil
        )
        try await retry.value.get()
        #expect(
            feature.cards.map(\.card.id) == [
                CardsTestIDs.firstPageCard,
                CardsTestIDs.secondPageCard,
            ]
        )
        #expect(feature.nextPageError == nil)
    }

    @Test
    func `Filter changes ignore an in-flight page from the previous collection`() async throws {
        let transport = PendingCollectionTransport()
        let feature = try await loadCards(transport, response: .paginated).get()
        let oldPage = Task { await feature.loadNextPage() }
        await transport.waitForRequest("/app-api/cards?cursor=page-two")
        let filtered = Task { await feature.load(game: .onePiece, setNames: [], query: nil, illustrators: []) }
        await transport.waitForRequest("/app-api/cards?game=one_piece")
        await transport.complete("/app-api/cards?game=one_piece", setName: "Romance Dawn")
        try await filtered.value.get()
        await transport.completePage(
            "/app-api/cards?cursor=page-two",
            id: CardsTestIDs.newFilterCard,
            cursor: "stale-cursor"
        )
        try await oldPage.value.get()
        #expect(feature.cards.isEmpty)
        #expect(feature.availableSetNames == ["Romance Dawn"])
        #expect(!feature.hasMoreCards)
        #expect(!feature.isLoadingNextPage)
    }

    @Test
    func `Cancelled subsequent pages do not publish their rows`() async throws {
        let transport = PendingCollectionTransport()
        let feature = try await loadCards(transport, response: .paginated).get()
        let next = Task { await feature.loadNextPage() }
        await transport.waitForRequest("/app-api/cards?cursor=page-two")
        next.cancel()
        await transport.completePage(
            "/app-api/cards?cursor=page-two",
            id: CardsTestIDs.oldFilterCard,
            cursor: nil
        )
        try await next.value.get()
        #expect(feature.cards.map(\.card.id) == [CardsTestIDs.firstPageCard])
        #expect(feature.hasMoreCards)
        #expect(!feature.isLoadingNextPage)
        #expect(feature.nextPageError == nil)
    }

    @Test
    func `Refresh preserves loaded depth and publishes the first replacement page immediately`() async throws {
        let transport = PendingCollectionTransport()
        let feature = try await loadCards(transport, response: .paginated).get()
        let next = Task { await feature.loadNextPage() }
        await transport.waitForRequest("/app-api/cards?cursor=page-two")
        await transport.completePage(
            "/app-api/cards?cursor=page-two",
            id: CardsTestIDs.secondPageCard,
            cursor: "page-three"
        )
        try await next.value.get()

        let refresh = Task { await feature.retryImportRefresh() }
        await transport.waitForRequest("/app-api/cards")
        await transport.completePage(
            "/app-api/cards",
            id: CardsTestIDs.staleCard,
            cursor: "new-page-two"
        )
        await transport.waitForRequest("/app-api/cards?cursor=new-page-two")
        #expect(
            feature.cards.map(\.card.id) == [
                CardsTestIDs.staleCard
            ]
        )
        await transport.completePage(
            "/app-api/cards?cursor=new-page-two",
            id: CardsTestIDs.freshCard,
            cursor: "new-page-three"
        )
        #expect(await refresh.value)
        #expect(
            feature.cards.map(\.card.id) == [
                CardsTestIDs.staleCard,
                CardsTestIDs.freshCard,
            ]
        )
        #expect(feature.hasMoreCards)
        #expect(await transport.requestCount == 4)
    }

    @Test
    func `Scrolling and refresh deduplicate cards while retaining page depth`() async throws {
        let transport = PendingCollectionTransport()
        let feature = makePendingFeature(transport)
        let initial = Task { await feature.load(game: nil, setNames: [], query: nil, illustrators: []) }
        await transport.waitForRequest("/app-api/cards")
        await transport.completePage(
            "/app-api/cards",
            id: CardsTestIDs.loadedCard,
            cursor: "page-two"
        )
        try await initial.value.get()

        let next = Task { await feature.loadNextPage() }
        await transport.waitForRequest("/app-api/cards?cursor=page-two")
        await transport.completePage(
            "/app-api/cards?cursor=page-two",
            id: CardsTestIDs.loadedCard,
            cursor: nil
        )
        try await next.value.get()
        #expect(feature.cards.map(\.card.id) == [CardsTestIDs.loadedCard])
        #expect(!feature.hasMoreCards)

        let refresh = Task { await feature.retryImportRefresh() }
        await transport.waitForRequest("/app-api/cards")
        await transport.completePage(
            "/app-api/cards",
            id: CardsTestIDs.updatedCard,
            cursor: "new-page-two"
        )
        await transport.waitForRequest("/app-api/cards?cursor=new-page-two")
        #expect(feature.cards.map(\.card.id) == [CardsTestIDs.updatedCard])
        await transport.completePage(
            "/app-api/cards?cursor=new-page-two",
            id: CardsTestIDs.updatedCard,
            cursor: nil
        )
        #expect(await refresh.value)
        #expect(feature.cards.map(\.card.id) == [CardsTestIDs.updatedCard])
        #expect(feature.availableSetNames == ["Base Set", "Crown Zenith"])
        #expect(!feature.hasMoreCards)
        #expect(await transport.requestCount == 4)
    }

    @Test
    func `Repeating subsequent cursors fail without changing the loaded cards`() async throws {
        let transport = PendingCollectionTransport()
        let feature = makePendingFeature(transport)
        let initial = Task { await feature.load(game: nil, setNames: [], query: nil, illustrators: []) }
        await transport.waitForRequest("/app-api/cards")
        await transport.completePage(
            "/app-api/cards",
            id: CardsTestIDs.firstPageCard,
            cursor: "same"
        )
        try await initial.value.get()
        let next = Task { await feature.loadNextPage() }
        await transport.waitForRequest("/app-api/cards?cursor=same")
        await transport.completePage(
            "/app-api/cards?cursor=same",
            id: CardsTestIDs.secondPageCard,
            cursor: "same"
        )
        await #expect(throws: TCGCardsOperationError.serverUnavailable) { try await next.value.get() }
        #expect(feature.cards.map(\.card.id) == [CardsTestIDs.firstPageCard])
        #expect(feature.nextPageError == .serverUnavailable)
    }

    private enum InitialCards {
        case paginated, cached
    }

    private func loadCards(_ transport: PendingCollectionTransport, response: InitialCards) async -> Result<
        TCGCards, TCGCardsOperationError
    > {
        let feature = makePendingFeature(transport)
        let initial = Task { await feature.load(game: nil, setNames: [], query: nil, illustrators: []) }
        await transport.waitForRequest("/app-api/cards")
        switch response {
        case .paginated:
            await transport.completePage("/app-api/cards", id: CardsTestIDs.firstPageCard, cursor: "page-two")
        case .cached:
            await transport.completeWithCachedCards("/app-api/cards")
        }
        return await initial.value.map { feature }
    }

    private func makePendingFeature(
        _ transport: PendingCollectionTransport,
        snapshot: CollectionSnapshotCache = CollectionSnapshotCache(),
        now: @escaping () -> Date = { .now }
    ) -> TCGCards {
        TCGCards(client: makePendingClient(transport), snapshot: snapshot, now: now)
    }

    private func makePendingClient(_ transport: PendingCollectionTransport) -> TCGClient {
        let credentials = Credentials(
            authToken: "auth-token",
            authTokenExpiryDate: .distantFuture,
            sessionToken: "session-token",
            sessionUpdateAge: 1800,
            lastSessionUpdate: .now
        )
        return .default(
            transport: transport,
            credentialsKeychainKey: "collection-load-tests",
            credentialsStore: InMemoryCredentialsStore(seed: try? JSONEncoder().encode(credentials))
        )
    }
}

@MainActor
private final class CollectionTestClock {
    var now: Date

    init(now: Date) {
        self.now = now
    }
}

private actor PendingCollectionTransport: ClientTransport {
    private let holdPrices: Bool
    private(set) var requestCount = 0
    private(set) var deletionIDs: [[UUID]] = []
    private(set) var priceIDs: [[UUID]] = []
    private var pending: [String: [CheckedContinuation<(HTTPResponse, HTTPBody?), Never>]] = [:]
    private var pendingCountWaiters: [String: (Int, CheckedContinuation<Void, Never>)] = [:]
    private var waiters: [String: CheckedContinuation<Void, Never>] = [:]

    init(holdPrices: Bool = false) {
        self.holdPrices = holdPrices
    }

    func send(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL _: URL,
        operationID _: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        guard let path = request.path else { preconditionFailure("Collection requests require a path.") }
        if path == "/app-api/cards/prices" {
            guard holdPrices else { return (HTTPResponse(status: .ok), HTTPBody("{\"prices\":[]}")) }
            guard let body else { preconditionFailure("Pricing requests require a body.") }

            let data = try await Data(collecting: body, upTo: .max)
            let payload = try JSONDecoder().decode(Components.Schemas.OwnedCardPricesRequest.self, from: data)
            priceIDs.append(payload.cardIds.compactMap(UUID.init(uuidString:)))
        }
        requestCount += 1
        if request.method == .delete {
            guard let body else { preconditionFailure("Deletion requests require a body.") }
            let data = try await Data(collecting: body, upTo: .max)
            deletionIDs.append(try JSONDecoder().decode(DeleteCardsPayload.self, from: data).cardIDs)
        }
        return await withCheckedContinuation { continuation in
            pending[path, default: []].append(continuation)
            if let (count, waiter) = pendingCountWaiters[path], pending[path, default: []].count >= count {
                pendingCountWaiters.removeValue(forKey: path)
                waiter.resume()
            }
            waiters.removeValue(forKey: path)?.resume()
        }
    }

    func waitForRequest(_ path: String) async {
        if pending[path] != nil { return }
        await withCheckedContinuation { waiters[path] = $0 }
    }

    func waitForRequests(_ path: String, count: Int) async {
        if pending[path, default: []].count >= count { return }
        await withCheckedContinuation { pendingCountWaiters[path] = (count, $0) }
    }

    private func takeRequest(_ path: String) -> CheckedContinuation<(HTTPResponse, HTTPBody?), Never> {
        guard var requests = pending[path], !requests.isEmpty else {
            preconditionFailure("A collection request must be pending before completion.")
        }
        let request = requests.removeFirst()
        pending[path] = requests.isEmpty ? nil : requests
        return request
    }

    func complete(_ path: String, setName: String) {
        let continuation = takeRequest(path)
        let body = """
            {"entries": [], "available_illustrators": [], "available_set_names": ["\(setName)"], "next_cursor": null}
            """
        continuation.resume(returning: (HTTPResponse(status: .ok), HTTPBody(body)))
    }

    func complete(_ path: String, status: HTTPResponse.Status) {
        let continuation = takeRequest(path)
        continuation.resume(returning: (HTTPResponse(status: status), HTTPBody("{}")))
    }

    func completeCardNotFound(_ path: String) {
        let body = """
            {"message":"Card not found","code":"CARD_NOT_FOUND"}
            """
        takeRequest(path).resume(returning: (HTTPResponse(status: .notFound), HTTPBody(body)))
    }

    func completeCollections(id: UUID) {
        let json = """
            {"collections":[{"id":"\(id)","name":"Favorites","is_unfiled":false,"revision":1}]}
            """
        completeJSON("/app-api/collections", body: json)
    }

    func completeBinder(id: UUID, page: UUID, path: String) {
        let json = """
            {"id":"\(id)","name":"Favorites","is_unfiled":false,"revision":1,
             "columns":3,"rows":3,"pages":[{"id":"\(page)","slots":[]}]}
            """
        completeJSON(path, body: json)
    }

    func completeBinderPage(_ path: String) {
        completeJSON(path, body: "{\"cards\":[]}")
    }

    private func completeJSON(_ path: String, body: String) {
        takeRequest(path).resume(returning: (HTTPResponse(status: .ok), HTTPBody(body)))
    }

    func completePrice(
        id: UUID,
        updatedAt: Date = Date(timeIntervalSince1970: 1_784_543_400),
        status: OwnedCardPriceStatus = .noPrice
    ) {
        let revision = Date.ISO8601FormatStyle(includingFractionalSeconds: true).format(updatedAt)
        let body = """
            {"prices":[{
              "id":"\(id)","updated_at":"\(revision)",
              "purchases":[],"purchase_price_change_percent":null,
              "price":{"card_id":"\(id)","status":"\(status.rawValue)"}
            }]}
            """
        takeRequest("/app-api/cards/prices").resume(returning: (HTTPResponse(status: .ok), HTTPBody(body)))
    }

    func completePage(_ path: String, id: UUID, cursor: String?) {
        let continuation = takeRequest(path)
        let nextCursor = cursor.map { "\"\($0)\"" } ?? "null"
        let body = """
            {
              "entries": [{
                "id": "\(id)", "game": "pokemon", "name": "Pikachu",
                "set_name": "Base Set", "card_number": "58/102", "notes": null,
                "purchases": [], "purchase_price_change_percent": null,
                "created_at": "2026-07-20T10:30:00.000Z", "updated_at": "2026-07-20T10:30:00.000Z",
                "price": {"card_id": "\(id)", "status": "no_price"}
              }],
              "available_illustrators": [], "available_set_names": ["Base Set", "Crown Zenith"],
              "next_cursor": \(nextCursor)
            }
            """
        continuation.resume(returning: (HTTPResponse(status: .ok), HTTPBody(body)))
    }

    func completeShiftryPage(_ path: String) {
        let id = CardsTestIDs.cachedPokemon
        completeJSON(
            path,
            body: """
                {"entries":[{"id":"\(id)","game":"pokemon","name":"ダーテング","set_name":"Cyber Judge",
                  "card_number":"072/071","english_search_alias":"Shiftry","notes":null,"purchases":[],
                  "purchase_price_change_percent":null,"created_at":"2026-07-20T10:30:00.000Z",
                  "updated_at":"2026-07-20T10:30:00.000Z",
                  "price":{"card_id":"\(id)","status":"no_price"}}],
                 "available_illustrators":[],"available_set_names":["Cyber Judge"],"next_cursor":null}
                """
        )
    }

    func completeDeletion(deletedIDs: [UUID], notFoundIDs: [UUID]) throws {
        let path = "/app-api/cards"
        let continuation = takeRequest(path)
        let body = try JSONSerialization.data(withJSONObject: [
            "deleted_ids": deletedIDs.map { $0.uuidString.lowercased() },
            "not_found_ids": notFoundIDs.map { $0.uuidString.lowercased() },
        ])
        continuation.resume(returning: (HTTPResponse(status: .ok), HTTPBody(body)))
    }

    func completeWithCachedCards(_ path: String) {
        let continuation = takeRequest(path)
        let body = """
            {"entries": [
              {"id": "00000000-0000-4000-8000-000000000060", "game": "pokemon", "name": "Pikachu",
               "set_name": "Base Set", "card_number": "58/102", "notes": null, "purchases": [], "purchase_price_change_percent": null,
               "created_at": "2026-07-20T10:30:00.000Z", "updated_at": "2026-07-20T10:30:00.000Z",
               "price": {"card_id": "00000000-0000-4000-8000-000000000060", "status": "no_price"}},
              {"id": "00000000-0000-4000-8000-000000000061", "game": "one_piece", "name": "Luffy",
               "set_name": "Romance Dawn", "card_number": "OP01-003", "notes": null, "purchases": [], "purchase_price_change_percent": null,
               "created_at": "2026-07-20T10:30:00.000Z", "updated_at": "2026-07-20T10:30:00.000Z",
               "price": {"card_id": "00000000-0000-4000-8000-000000000061", "status": "no_price"}}
            ], "available_illustrators": [], "available_set_names": ["Base Set", "Romance Dawn"], "next_cursor": null}
            """
        continuation.resume(returning: (HTTPResponse(status: .ok), HTTPBody(body)))
    }
}

var validValues: CardFormValues {
    CardFormValues(
        game: .onePiece,
        name: "Monkey D. Luffy",
        setName: "Romance Dawn",
        cardNumber: "OP01-003",
        notes: "",
        quantities: [.nearMint: 2]
    )
}
