import SwiftUI
import TCGClient

public struct CurrencyAmount: View {
    private let amount: Decimal
    private let marketAmount: Decimal?
    private let source: Currency
    private let label: String?
    private let conversionUnavailable: Bool

    public init(_ amount: Decimal, currency: Currency, label: String?, conversionUnavailable: Bool) {
        self.amount = amount
        marketAmount = nil
        source = currency
        self.label = label
        self.conversionUnavailable = conversionUnavailable
    }

    public init(_ amount: Double, currency: Currency, label: String?, conversionUnavailable: Bool) {
        self.init(Decimal(amount), currency: currency, label: label, conversionUnavailable: conversionUnavailable)
    }

    public init(low: Double, market: Double, currency: Currency, conversionUnavailable: Bool) {
        amount = Decimal(low)
        marketAmount = Decimal(market)
        source = currency
        label = nil
        self.conversionUnavailable = conversionUnavailable
    }

    public var body: some View {
        if conversionUnavailable {
            VStack(alignment: .trailing, spacing: 2) {
                amountLine
                Text("Conversion unavailable", bundle: .module).font(.caption2).foregroundStyle(.secondary)
            }
        } else {
            amountLine
        }
    }

    @ViewBuilder
    private var amountLine: some View {
        if let marketAmount {
            let format = Decimal.FormatStyle.Currency(code: source.rawValue)
            let range = Text("\(amount, format: format) - \(marketAmount, format: format)", bundle: .module)
            let visibleAmount =
                conversionUnavailable ? Text("\(range) (\(source.rawValue))", bundle: .module) : range
            visibleAmount
                .lineLimit(1)
                .minimumScaleFactor(0.75)
                .accessibilityLabel(
                    Text("Low \(amount, format: format), market \(marketAmount, format: format)", bundle: .module)
                )
        } else if conversionUnavailable {
            if let label {
                Text(
                    "\(label) \(amount, format: .currency(code: source.rawValue)) (\(source.rawValue))",
                    bundle: .module
                )
            } else {
                Text("\(amount, format: .currency(code: source.rawValue)) (\(source.rawValue))", bundle: .module)
            }
        } else {
            formatted(amount, currency: source)
        }
    }

    private func formatted(_ amount: Decimal, currency: Currency) -> Text {
        if let label {
            return Text("\(label) \(amount, format: .currency(code: currency.rawValue))", bundle: .module)
        }
        return Text(amount, format: .currency(code: currency.rawValue))
    }

}
