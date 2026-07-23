//
//  PreviewTCGPricingClientTests.swift
//  TCGClient
//

import Testing

@testable import TCGClient

@Suite("Preview TCGPricing Client Tests")
struct PreviewTCGPricingClientTests {
    @Test
    func `Success returns sample search pricing`() async throws {
        let pricing = TCGClient.preview(pricingOutcome: .success).pricing

        #expect(
            try await pricing.search(game: .pokemon, query: "Giratina").get().matches
                == [PreviewTCGPricingClient.samplePricedCards[1]]
        )
    }

    @Test
    func `No results returns search guidance state`() async throws {
        let result = try await TCGClient.preview(pricingOutcome: .noResults).pricing
            .search(game: .onePiece, query: "Missing")
            .get()

        #expect(result.matches.isEmpty)
    }

    @Test
    func `Unauthorized rejects search pricing`() async {
        let pricing = TCGClient.preview(pricingOutcome: .unauthorized).pricing

        await #expect(throws: SearchPricingErrors.unauthorized) {
            try await pricing.search(game: .pokemon, query: "Giratina").get()
        }
    }

    @Test
    func `Server unavailable rejects search pricing`() async {
        let pricing = TCGClient.preview(pricingOutcome: .serverUnavailable).pricing

        await #expect(throws: SearchPricingErrors.unavailable) {
            try await pricing.search(game: .pokemon, query: "Giratina").get()
        }
    }
}
