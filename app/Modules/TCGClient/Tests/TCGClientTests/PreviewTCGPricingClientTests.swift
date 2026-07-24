//
//  PreviewTCGPricingClientTests.swift
//  TCGClient
//

import Testing

@testable import TCGClient

@Suite("Preview TCGPricing Client Tests")
struct PreviewTCGPricingClientTests {
    @Test
    func `Success returns sample search and owned pricing`() async throws {
        let pricing = TCGClient.preview(pricingOutcome: .success).pricing

        #expect(
            try await pricing.search(game: .pokemon, query: "Giratina").get().matches
                == [PreviewTCGPricingClient.samplePricedCards[1]]
        )
        #expect(try await pricing.ownedPrices(game: nil).get() == PreviewTCGPricingClient.sampleOwnedPrices)
    }

    @Test
    func `Empty returns no owned prices`() async throws {
        #expect(try await TCGClient.preview(pricingOutcome: .empty).pricing.ownedPrices(game: nil).get() == [])
    }

    @Test
    func `No results returns search guidance state`() async throws {
        let result = try await TCGClient.preview(pricingOutcome: .noResults).pricing
            .search(game: .onePiece, query: "Missing")
            .get()

        #expect(result.status == .noResults)
        #expect(result.matches.isEmpty)
    }

    @Test
    func `Unauthorized rejects search and owned pricing`() async {
        let pricing = TCGClient.preview(pricingOutcome: .unauthorized).pricing

        await #expect(throws: SearchPricingErrors.unauthorized) {
            try await pricing.search(game: .pokemon, query: "Giratina").get()
        }
        await #expect(throws: OwnedPricesErrors.unauthorized) {
            try await pricing.ownedPrices(game: nil).get()
        }
    }

    @Test
    func `Server unavailable rejects search and owned pricing`() async {
        let pricing = TCGClient.preview(pricingOutcome: .serverUnavailable).pricing

        await #expect(throws: SearchPricingErrors.unavailable) {
            try await pricing.search(game: .pokemon, query: "Giratina").get()
        }
        await #expect(throws: OwnedPricesErrors.unavailable) {
            try await pricing.ownedPrices(game: nil).get()
        }
    }
}
