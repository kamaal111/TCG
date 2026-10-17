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
        await assertScreenSnapshot(testName: #function) {
            VStack(alignment: .leading, spacing: 20) {
                CurrencyAmount(10.0, currency: .eur)
                CurrencyAmount(10.0, currency: .eur)
                CurrencyAmount(12.5, currency: .gbp, conversionUnavailable: true)
            }
            .padding(24)
        }
    }
}
