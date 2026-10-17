import Testing

@testable import TCGClient

@Suite("Preview currency client")
struct PreviewTCGCurrencyClientTests {
    @Test
    func `Preview factory provides currency preferences and fixed exchange rates`() async throws {
        let client = TCGClient.preview().currency
        let preference = try await client.preference().get()
        #expect(preference.currency == .fallback)
        #expect(preference.isExplicit)
        let updated = try await client.update(.init(preferredCurrency: .eur)).get()
        #expect(updated.currency == .eur)
        #expect(updated.isExplicit)
        let rates = try await client.latestRates().get()
        #expect(rates.date == "2026-10-16")
        #expect(rates.convert(12.5, from: .usd, to: .eur) == 10)
    }
}
