//
//  TCGSearchFeatureTests.swift
//  TCGFeatures
//

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

        #expect(feature.status == .ok)
        #expect(feature.results == [PreviewTCGPricingClient.samplePricedCards[1]])
    }

    @Test
    func `No results clears matches and records status`() async throws {
        let feature = TCGSearch(client: .preview(pricingOutcome: .noResults))

        try await feature.search(game: .onePiece, query: "Missing").get()

        #expect(feature.status == .noResults)
        #expect(feature.results.isEmpty)
    }

    @Test
    func `Server unavailable maps to a feature error`() async {
        let feature = TCGSearch(client: .preview(pricingOutcome: .serverUnavailable))

        await #expect(throws: TCGSearchOperationError.serverUnavailable) {
            try await feature.search(game: .pokemon, query: "Giratina").get()
        }
    }
}
