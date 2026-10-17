import SwiftUI
import TCGCurrency
import TCGSnapshotTesting
import Testing

@testable import TCGClient

@Suite("Currency amount snapshots")
@MainActor
struct TCGCurrencyAmountSnapshotTests {
    @Test
    func `Renders converted prices and missing-rate fallback`() async {
        let currency = TCGCurrency(client: .preview(), defaults: nil)
        await currency.refresh()
        #expect(await currency.save(.eur))
        await assertScreenSnapshot(testName: #function) {
            VStack(alignment: .leading, spacing: 20) {
                CurrencyAmount(12.5, currency: .usd)
                CurrencyAmount(1500.0, currency: .jpy)
                CurrencyAmount(12.5, currency: .gbp)
            }
            .padding(24)
            .environment(\.tcgCurrency, currency)
        }
    }
}
