//
//  TCGSearchFeatureTests.swift
//  TCGFeatures
//

import Foundation
import HTTPTypes
import KamaalAuth
import OpenAPIRuntime
import TCGCurrency
import Testing

@testable import TCGClient
@testable import TCGSearch

@Suite("TCGSearch Feature Tests")
@MainActor
struct TCGSearchFeatureTests {
    @Test
    func `Changing currency ignores an older search response`() async throws {
        let transport = HistoryPricingTransport(suspended: true)
        await transport.setOutcome(.updated, for: 2)
        let client = TCGClient.default(
            transport: transport,
            credentialsKeychainKey: "currency-search",
            credentialsStore: InMemoryCredentialsStore()
        )
        let feature = TCGSearch(client: client, history: TCGSearchHistoryStore())
        let currency = TCGCurrency(client: .preview(), defaults: nil)
        await feature.refreshDisplayPrices(for: currency.displayIdentity)
        let original = Task {
            await feature.search(.init(game: .pokemon, query: "Giratina", languages: [], mode: .card, cursor: nil))
        }
        await transport.waitUntilStarted()
        #expect(await currency.save(.eur))
        let refresh = Task { await feature.refreshDisplayPrices(for: currency.displayIdentity) }
        await transport.waitUntilStarted(count: 2)
        #expect(feature.results.isEmpty)
        await transport.resume(count: 2)
        await refresh.value
        #expect(feature.results.first?.headline?.amount == 20)
        await transport.resume()
        try await original.value.get()
        #expect(feature.results.first?.headline?.amount == 20)
        #expect(feature.displayRefreshError == nil)
    }

    @Test
    func `A failed currency refresh leaves no old search prices`() async throws {
        let transport = HistoryPricingTransport()
        await transport.setOutcome(.unavailable, for: 2)
        let client = TCGClient.default(
            transport: transport,
            credentialsKeychainKey: "failed-currency-search",
            credentialsStore: InMemoryCredentialsStore()
        )
        let feature = TCGSearch(client: client, history: TCGSearchHistoryStore())
        let currency = TCGCurrency(client: .preview(), defaults: nil)
        await feature.refreshDisplayPrices(for: currency.displayIdentity)
        try await feature.search(.init(game: .pokemon, query: "Giratina", languages: [], mode: .card, cursor: nil))
            .get()
        #expect(!feature.results.isEmpty)
        #expect(await currency.save(.eur))
        await feature.refreshDisplayPrices(for: currency.displayIdentity)
        #expect(feature.results.isEmpty)
        #expect(feature.displayRefreshError == .serverUnavailable)
    }

    @Test
    func `Completed search identity is normalized retained on cancellation and reset on clearing`() async throws {
        let feature = TCGSearch(client: .preview(pricingOutcome: .success), history: TCGSearchHistoryStore())
        try await feature.search(
            .init(game: .pokemon, query: "  Giratina  ", languages: [.english, .japanese], mode: .card, cursor: nil)
        )
        .get()
        let identity = TCGSearch.SearchIdentity(
            .init(game: .pokemon, query: "Giratina", languages: [], mode: .card, cursor: nil)
        )
        #expect(feature.completedSearch == identity)
        feature.cancel()
        #expect(feature.completedSearch == identity)
        #expect(feature.hasSearched)
        feature.clear()
        #expect(feature.completedSearch == nil)
        #expect(!feature.hasSearched)
        #expect(feature.results.isEmpty)
    }

    @Test
    func `Next page ignores duplicate triggers and appends unseen cards in order`() async throws {
        let transport = HistoryPricingTransport(suspended: true)
        await transport.setOutcome(.firstPage, for: 1)
        await transport.setOutcome(.sets, for: 2)
        let feature = makePaginationFeature(transport)
        let first = Task {
            await feature.search(.init(game: .pokemon, query: "Giratina", languages: [], mode: .card, cursor: nil))
        }
        await transport.waitUntilStarted()
        await transport.resume()
        try await first.value.get()
        let cursor = try #require(feature.nextCursor)

        let next = Task { await feature.loadNextPage(cursor, retry: false) }
        await transport.waitUntilStarted(count: 2)
        #expect(feature.isLoadingNextPage)
        await feature.loadNextPage(cursor, retry: false)
        #expect(await transport.requestCount == 2)
        await transport.resume(count: 2)
        await next.value

        #expect(feature.results.map(\.id) == ["zenith", "origin", "zenith-2", "unknown"])
        #expect(feature.nextCursor == nil)
        #expect(!feature.isLoadingNextPage)
        await feature.loadNextPage(cursor, retry: false)
        #expect(await transport.requestCount == 2)
    }

    @Test
    func `Retry preserves loaded cards and requests the same cursor after a failure`() async throws {
        let transport = HistoryPricingTransport()
        await transport.setOutcome(.firstPage, for: 1)
        await transport.setOutcome(.unavailable, for: 2)
        let feature = makePaginationFeature(transport)
        try await feature.search(.init(game: .pokemon, query: "Giratina", languages: [], mode: .card, cursor: nil))
            .get()
        let cursor = try #require(feature.nextCursor)

        await feature.loadNextPage(cursor, retry: false)
        #expect(feature.didFailToLoadNextPage)
        #expect(feature.results.map(\.id) == ["zenith"])
        await feature.loadNextPage(cursor, retry: false)
        #expect(await transport.requestCount == 2)
        await feature.loadNextPage(cursor, retry: true)

        let continuationPath =
            "/app-api/pricing/search?search_by=card&cursor=continue-search&game=pokemon&query=Giratina"
        let paths = await transport.paths
        #expect(Array(paths.dropFirst()) == [continuationPath, continuationPath])
        #expect(feature.results.map(\.id) == ["zenith", "giratina"])
        #expect(!feature.didFailToLoadNextPage)
    }

    @Test
    func `Changing search discards a delayed continuation response`() async throws {
        let transport = HistoryPricingTransport(suspended: true)
        await transport.setOutcome(.firstPage, for: 1)
        await transport.setOutcome(.sets, for: 2)
        await transport.setOutcome(.empty, for: 3)
        let feature = makePaginationFeature(transport)
        let first = Task {
            await feature.search(.init(game: .pokemon, query: "Giratina", languages: [], mode: .card, cursor: nil))
        }
        await transport.waitUntilStarted()
        await transport.resume()
        try await first.value.get()
        let cursor = try #require(feature.nextCursor)
        let next = Task { await feature.loadNextPage(cursor, retry: false) }
        await transport.waitUntilStarted(count: 2)

        let replacement = Task {
            await feature.search(.init(game: .pokemon, query: "Pikachu", languages: [], mode: .card, cursor: nil))
        }
        await transport.waitUntilStarted(count: 3)
        await transport.resume(count: 3)
        try await replacement.value.get()
        await transport.resume(count: 2)
        await next.value

        #expect(feature.completedSearch?.query == "Pikachu")
        #expect(feature.results.isEmpty)
        #expect(feature.nextCursor == nil)
        #expect(!feature.isLoadingNextPage)
    }

    private func makePaginationFeature(_ transport: HistoryPricingTransport) -> TCGSearch {
        TCGSearch(
            client: .default(
                transport: transport,
                credentialsKeychainKey: "pagination-search",
                credentialsStore: InMemoryCredentialsStore()
            ),
            history: TCGSearchHistoryStore()
        )
    }

    @Test
    func `Search populates matching priced cards`() async throws {
        let feature = TCGSearch(client: .preview(pricingOutcome: .success), history: TCGSearchHistoryStore())

        try await feature.search(.init(game: .pokemon, query: "Giratina", languages: [], mode: .card, cursor: nil))
            .get()

        #expect(feature.hasSearched)
        #expect(feature.results == [PreviewTCGPricingClient.samplePricedCards[1]])
    }

    @Test
    func `No results clears matches and records that a search happened`() async throws {
        let feature = TCGSearch(client: .preview(pricingOutcome: .noResults), history: TCGSearchHistoryStore())

        try await feature.search(.init(game: .onePiece, query: "Missing", languages: [], mode: .card, cursor: nil))
            .get()

        #expect(feature.hasSearched)
        #expect(feature.results.isEmpty)
    }

    @Test
    func `Server unavailable maps to a feature error`() async {
        let feature = TCGSearch(client: .preview(pricingOutcome: .serverUnavailable), history: TCGSearchHistoryStore())

        await #expect(throws: TCGSearchOperationError.serverUnavailable) {
            try await feature.search(.init(game: .pokemon, query: "Giratina", languages: [], mode: .card, cursor: nil))
                .get()
        }
    }

    @Test
    func `A changed language supersedes a delayed search failure`() async throws {
        let transport = LanguagePricingTransport()
        let client = TCGClient.default(
            transport: transport,
            credentialsKeychainKey: "language-pricing-test-credentials",
            credentialsStore: InMemoryCredentialsStore()
        )
        let feature = TCGSearch(client: client, history: TCGSearchHistoryStore())
        let first = Task {
            await feature.search(
                .init(game: .pokemon, query: "Shiftry", languages: [.japanese], mode: .card, cursor: nil)
            )
        }
        await transport.waitUntilStarted()
        try await feature.search(
            .init(game: .pokemon, query: "Shiftry", languages: [.english], mode: .card, cursor: nil)
        )
        .get()
        await transport.releaseFirstSearch()
        try await first.value.get()

        #expect(feature.hasSearched)
        #expect(!feature.isSearching)
        #expect(feature.results.isEmpty)
        #expect(
            feature.completedSearch
                == TCGSearch.SearchIdentity(
                    .init(game: .pokemon, query: "Shiftry", languages: [.english], mode: .card, cursor: nil)
                )
        )
        #expect(
            await transport.paths == [
                "/app-api/pricing/search?search_by=card&languages=ja&game=pokemon&query=Shiftry",
                "/app-api/pricing/search?search_by=card&languages=en&game=pokemon&query=Shiftry",
            ]
        )
    }

    @Test
    func `Cancelling a superseded search does not report a failure`() async throws {
        let transport = SuspendedPricingTransport()
        let client = TCGClient.default(
            transport: transport,
            credentialsKeychainKey: "cancelled-pricing-test-credentials",
            credentialsStore: InMemoryCredentialsStore()
        )
        let feature = TCGSearch(client: client, history: TCGSearchHistoryStore())
        let task = Task {
            await feature.search(.init(game: .pokemon, query: "Pikachu", languages: [], mode: .card, cursor: nil))
        }
        await transport.waitUntilStarted()

        task.cancel()
        try await task.value.get()

        #expect(!feature.isSearching)
        #expect(!feature.hasSearched)
        #expect(feature.results.isEmpty)
    }
}

private actor SuspendedPricingTransport: ClientTransport {
    private var hasStarted = false
    private var startedContinuation: CheckedContinuation<Void, Never>?

    func waitUntilStarted() async {
        if hasStarted { return }
        await withCheckedContinuation { startedContinuation = $0 }
    }

    func send(
        _: HTTPRequest,
        body _: HTTPBody?,
        baseURL _: URL,
        operationID _: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        hasStarted = true
        startedContinuation?.resume()
        startedContinuation = nil
        try await Task.sleep(for: .seconds(60))
        throw CancellationError()
    }
}

private actor LanguagePricingTransport: ClientTransport {
    private(set) var paths: [String] = []
    private var startedContinuation: CheckedContinuation<Void, Never>?
    private var firstSearchContinuation: CheckedContinuation<Void, Never>?

    func waitUntilStarted() async {
        if !paths.isEmpty { return }
        await withCheckedContinuation { startedContinuation = $0 }
    }

    func releaseFirstSearch() {
        firstSearchContinuation?.resume()
        firstSearchContinuation = nil
    }

    func send(
        _ request: HTTPRequest,
        body _: HTTPBody?,
        baseURL _: URL,
        operationID _: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        paths.append(request.path ?? "")
        if paths.count == 1 {
            await withCheckedContinuation { continuation in
                firstSearchContinuation = continuation
                startedContinuation?.resume()
                startedContinuation = nil
            }
            return (HTTPResponse(status: .serviceUnavailable), nil)
        }
        return (
            HTTPResponse(status: .ok),
            HTTPBody(
                Data(
                    """
                    {"matches": []}
                    """.utf8
                )
            )
        )
    }
}
