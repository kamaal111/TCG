import Foundation
import Testing

@testable import TCGCurrency

@Suite("Price privacy preferences")
@MainActor
struct TCGPricePrivacyTests {
    @Test
    func `Prices are visible without a saved preference`() throws {
        let suite = "TCGPricePrivacyTests.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }

        #expect(!TCGPricePrivacy(defaults: defaults).hidePrices)
    }

    @Test
    func `Both preference values survive a new state instance`() throws {
        let suite = "TCGPricePrivacyTests.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let privacy = TCGPricePrivacy(defaults: defaults)

        privacy.hidePrices = true
        #expect(defaults.bool(forKey: "TCG.privacy.hidePrices"))
        #expect(TCGPricePrivacy(defaults: defaults).hidePrices)

        privacy.hidePrices = false
        #expect(defaults.object(forKey: "TCG.privacy.hidePrices") as? Bool == false)
        #expect(!TCGPricePrivacy(defaults: defaults).hidePrices)
    }

    @Test
    func `In-memory preferences are isolated`() {
        let privacy = TCGPricePrivacy(defaults: nil)
        #expect(!privacy.hidePrices)

        privacy.hidePrices = true
        #expect(privacy.hidePrices)
        #expect(!TCGPricePrivacy(defaults: nil).hidePrices)
    }
}
