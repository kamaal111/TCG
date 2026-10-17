import SwiftUI
import TCGClient

public struct CurrencyAmount: View {
    @Environment(\.tcgCurrency) private var currencyState
    private let amount: Decimal
    private let source: Currency
    private let label: String?

    public init(_ amount: Decimal, currency: Currency, label: String? = nil) {
        self.amount = amount
        source = currency
        self.label = label
    }

    public init(_ amount: Double, currency: Currency, label: String? = nil) {
        self.init(Decimal(amount), currency: currency, label: label)
    }

    public var body: some View {
        if let currencyState {
            if let converted = currencyState.converted(amount, from: source) {
                formatted(converted, currency: currencyState.preferredCurrency)
            } else {
                VStack(alignment: .trailing, spacing: 2) {
                    if let label {
                        Text(
                            "\(label) \(amount, format: .currency(code: source.rawValue)) (\(source.rawValue))",
                            bundle: .module
                        )
                    } else {
                        Text(
                            "\(amount, format: .currency(code: source.rawValue)) (\(source.rawValue))",
                            bundle: .module
                        )
                    }
                    Text("Conversion unavailable", bundle: .module).font(.caption2).foregroundStyle(.secondary)
                }
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
