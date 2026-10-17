import SwiftUI
import TCGClient

public struct CurrencyAmount: View {
    private let amount: Decimal
    private let source: Currency
    private let label: String?
    private let conversionUnavailable: Bool

    public init(_ amount: Decimal, currency: Currency, label: String? = nil, conversionUnavailable: Bool = false) {
        self.amount = amount
        source = currency
        self.label = label
        self.conversionUnavailable = conversionUnavailable
    }

    public init(_ amount: Double, currency: Currency, label: String? = nil, conversionUnavailable: Bool = false) {
        self.init(Decimal(amount), currency: currency, label: label, conversionUnavailable: conversionUnavailable)
    }

    public var body: some View {
        if conversionUnavailable {
            VStack(alignment: .trailing, spacing: 2) {
                if let label {
                    Text(
                        "\(label) \(amount, format: .currency(code: source.rawValue)) (\(source.rawValue))",
                        bundle: .module
                    )
                } else {
                    Text("\(amount, format: .currency(code: source.rawValue)) (\(source.rawValue))", bundle: .module)
                }
                Text("Conversion unavailable", bundle: .module).font(.caption2).foregroundStyle(.secondary)
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
