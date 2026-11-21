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
        await assertScreenSnapshot(testName: #function, fileID: #fileID, file: #filePath, line: #line, column: #column)
        {
            VStack(alignment: .leading, spacing: 20) {
                CurrencyAmount(10.0, currency: .eur, label: nil, conversionUnavailable: false)
                CurrencyAmount(low: 10, market: 14, currency: .eur, conversionUnavailable: false)
                CurrencyAmount(12.5, currency: .gbp, label: nil, conversionUnavailable: true)
                CurrencyAmount(low: 12.5, market: 17, currency: .gbp, conversionUnavailable: true)
            }
            .padding(24)
        }
    }
}
