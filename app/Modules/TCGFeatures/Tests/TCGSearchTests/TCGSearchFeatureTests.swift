//
//  TCGSearchFeatureTests.swift
//  TCGFeatures
//

import Foundation
import HTTPTypes
import KamaalAuth
import OpenAPIRuntime
import Testing

@testable import TCGClient
@testable import TCGSearch

@Suite("TCGSearch Feature Tests")
@MainActor
struct TCGSearchFeatureTests {
    @Test
    func `Completed search identity is normalized retained on cancellation and reset on clearing`() async throws {
        let feature = TCGSearch(client: .preview(pricingOutcome: .success), history: TCGSearchHistoryStore())
        try await feature.search(game: .pokemon, query: "  Giratina  ", languages: [.english, .japanese]).get()
        let identity = TCGSearch.SearchIdentity(game: .pokemon, query: "Giratina", languages: [])
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
    func `Search populates matching priced cards`() async throws {
        let feature = TCGSearch(client: .preview(pricingOutcome: .success), history: TCGSearchHistoryStore())

        try await feature.search(game: .pokemon, query: "Giratina").get()

        #expect(feature.hasSearched)
        #expect(feature.results == [PreviewTCGPricingClient.samplePricedCards[1]])
    }

    @Test
    func `No results clears matches and records that a search happened`() async throws {
        let feature = TCGSearch(client: .preview(pricingOutcome: .noResults), history: TCGSearchHistoryStore())

        try await feature.search(game: .onePiece, query: "Missing").get()

        #expect(feature.hasSearched)
        #expect(feature.results.isEmpty)
    }

    @Test
    func `Server unavailable maps to a feature error`() async {
        let feature = TCGSearch(client: .preview(pricingOutcome: .serverUnavailable), history: TCGSearchHistoryStore())

        await #expect(throws: TCGSearchOperationError.serverUnavailable) {
            try await feature.search(game: .pokemon, query: "Giratina").get()
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
        let first = Task { await feature.search(game: .pokemon, query: "Shiftry", languages: [.japanese]) }
        await transport.waitUntilStarted()
        try await feature.search(game: .pokemon, query: "Shiftry", languages: [.english]).get()
        await transport.releaseFirstSearch()
        try await first.value.get()

        #expect(feature.hasSearched)
        #expect(!feature.isSearching)
        #expect(feature.results.isEmpty)
        #expect(
            feature.completedSearch == TCGSearch.SearchIdentity(game: .pokemon, query: "Shiftry", languages: [.english])
        )
        #expect(
            await transport.paths == [
                "/app-api/pricing/search?languages=ja&game=pokemon&query=Shiftry",
                "/app-api/pricing/search?languages=en&game=pokemon&query=Shiftry",
            ])
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
        let task = Task { await feature.search(game: .pokemon, query: "Pikachu") }
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
                    """.utf8))
        )
    }
}
