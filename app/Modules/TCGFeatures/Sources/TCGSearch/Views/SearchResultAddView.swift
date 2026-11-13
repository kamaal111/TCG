import SwiftUI
import TCGClient
import TCGCurrency
import TCGDesignSystem

struct SearchResultAddView<AddForm: View>: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.tcgCurrency) private var currencyState
    @Environment(\.tcgPricePrivacy) private var pricePrivacy
    @State private var selection: PricedCard?

    let card: PricedCard
    let variants: [PricedCard]
    @ViewBuilder let addForm: (PricedCard) -> AddForm

    var body: some View {
        if variants.count < 2 {
            addForm(card)
        } else if let selection {
            addForm(selection)
        } else {
            picker
        }
    }

    private var picker: some View {
        NavigationStack {
            List(variants) { variant in
                Button {
                    selection = variant
                } label: {
                    variantRow(variant)
                }
                .buttonStyle(.plain)
            }
            .navigationTitle(Text("Choose a variant", bundle: .module))
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button {
                        dismiss()
                    } label: {
                        Text("Cancel", bundle: .module)
                    }
                    .keyboardShortcut(.cancelAction)
                }
            }
        }
        #if os(macOS)
            .frame(minWidth: 420, minHeight: 340)
        #endif
    }

    private func variantRow(_ variant: PricedCard) -> some View {
        HStack(spacing: 12) {
            CardImageView(url: variant.imageURL)
            VStack(alignment: .leading) {
                if let name = variant.variantName {
                    Text(
                        name.replacingOccurrences(of: "([a-z0-9])([A-Z])", with: "$1 $2", options: .regularExpression)
                            .capitalized
                    )
                } else {
                    Text("Standard", bundle: .module)
                }
                if let illustrator = variant.illustrator {
                    Text(illustrator).foregroundStyle(.secondary)
                }
            }
            Spacer()
            if pricePrivacy?.hidePrices != true {
                variantPrice(variant)
            }
        }
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private func variantPrice(_ variant: PricedCard) -> some View {
        if let currencyState, variant.display?.preferredCurrency != currencyState.preferredCurrency {
            ProgressView()
        } else if let headline = variant.displayHeadline {
            CurrencyAmount(
                headline.amount,
                currency: headline.currency,
                conversionUnavailable: variant.conversionUnavailable
            )
        } else if let market = variant.displayMarket, let amount = market.market {
            CurrencyAmount(amount, currency: market.currency, conversionUnavailable: variant.conversionUnavailable)
        } else {
            Text("No price", bundle: .module).foregroundStyle(.secondary)
        }
    }
}
