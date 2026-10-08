import SwiftUI
import TCGClient

struct PurchaseBatchFields: View {
    @Binding var batch: PurchaseBatchFormValue
    let marketCurrency: Currency?
    let remove: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Stepper(value: $batch.quantity, in: 1...999) {
                    Text("Quantity: \(batch.quantity)", bundle: .module)
                }
                Button(role: .destructive, action: remove) { Image(systemName: "trash") }
                    .buttonStyle(.borderless)
                    .accessibilityLabel(Text("Remove purchase batch", bundle: .module))
            }
            Text("Purchase price per card", bundle: .module).font(.caption)
            HStack {
                TextField(String(localized: "Optional price", bundle: .module), text: purchasePrice)
                    .accessibilityLabel(Text("Purchase price per card", bundle: .module))
                    #if os(iOS)
                        .keyboardType(.decimalPad)
                    #endif
                if let currency = marketCurrency {
                    Text(batch.persistedID == nil ? currency.rawValue : batch.currency.rawValue).foregroundStyle(
                        .secondary
                    )
                } else {
                    Picker(selection: $batch.currency) {
                        Text(verbatim: Currency.usd.rawValue).tag(Currency.usd)
                        Text(verbatim: Currency.jpy.rawValue).tag(Currency.jpy)
                    } label: {
                        Text("Currency", bundle: .module)
                    }
                    .fixedSize()
                }
            }
            if let price = batch.price {
                HStack {
                    Text("Batch total", bundle: .module)
                    Spacer()
                    Text(price * Decimal(batch.quantity), format: .currency(code: batch.currency.rawValue))
                }.font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(10)
        .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 8))
    }

    private var purchasePrice: Binding<String> {
        Binding(
            get: { batch.priceText },
            set: { value in
                batch.priceText = value
                batch.priceWasEdited = true
                if batch.persistedID == nil, let marketCurrency { batch.currency = marketCurrency }
            }
        )
    }
}
