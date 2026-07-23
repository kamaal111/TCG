//
//  TCGSearchFeatureTests.swift
//  TCGFeatures
//

import Foundation
import HTTPTypes
import OpenAPIRuntime
import Testing

@testable import TCGClient
@testable import TCGSearch

@Suite("TCGSearch Feature Tests")
@MainActor
struct TCGSearchFeatureTests {
    @Test
    func `Search populates matching priced cards`() async throws {
        let feature = TCGSearch(client: .preview(pricingOutcome: .success))

        try await feature.search(game: .pokemon, query: "Giratina").get()

        #expect(feature.hasSearched)
        #expect(feature.results == [PreviewTCGPricingClient.samplePricedCards[1]])
    }

    @Test
    func `No results clears matches and records that a search happened`() async throws {
        let feature = TCGSearch(client: .preview(pricingOutcome: .noResults))

        try await feature.search(game: .onePiece, query: "Missing").get()

        #expect(feature.hasSearched)
        #expect(feature.results.isEmpty)
    }

    @Test
    func `Server unavailable maps to a feature error`() async {
        let feature = TCGSearch(client: .preview(pricingOutcome: .serverUnavailable))

        await #expect(throws: TCGSearchOperationError.serverUnavailable) {
            try await feature.search(game: .pokemon, query: "Giratina").get()
        }
    }

    @Test
    func `Cancelling a superseded search does not report a failure`() async throws {
        let transport = SuspendedPricingTransport()
        let client = TCGClient.default(
            transport: transport,
            credentialsKeychainKey: "cancelled-pricing-test-credentials",
            credentialsStore: InMemoryCredentialsStore()
        )
        let feature = TCGSearch(client: client)
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
