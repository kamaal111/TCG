import SwiftUI
import TCGClient
import TCGCurrency
import TCGDesignSystem

struct SearchVariantPicker: View {
    enum Purpose {
        case add
        case details
        case artwork
    }

    @Environment(\.dismiss) private var dismiss
    @Environment(\.tcgCurrency) private var currencyState
    @Environment(\.tcgPricePrivacy) private var pricePrivacy

    let variants: [PricedCard]
    let purpose: Purpose
    var selectedID: String?
    let onSelect: (PricedCard) -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Choose a variant", bundle: .module)
                    .font(.headline)
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                Button {
                    dismiss()
                } label: {
                    Text("Cancel", bundle: .module)
                }
                .keyboardShortcut(.cancelAction)
            }
            .padding()
            Divider()
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    ForEach(variants) { variant in
                        Button {
                            onSelect(variant)
                        } label: {
                            variantRow(variant)
                        }
                        .buttonStyle(.plain)
                        .disabled(purpose == .artwork && variant.imageURL == nil)
                        .accessibilityAddTraits(selectedID == variant.id ? .isSelected : [])
                    }
                }
                .padding()
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
                SearchVariantLabel(card: variant)
                if let illustrator = variant.illustrator {
                    Text(illustrator).foregroundStyle(.secondary)
                }
                if purpose == .artwork && variant.imageURL == nil {
                    Text("Artwork unavailable", bundle: .module).foregroundStyle(.secondary)
                }
            }
            Spacer()
            if purpose != .artwork && pricePrivacy?.hidePrices != true {
                variantPrice(variant)
            }
            if selectedID == variant.id {
                Image(systemName: "checkmark").accessibilityHidden(true)
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

struct SearchVariantLabel: View {
    let card: PricedCard

    var body: some View {
        if let name = card.variantName {
            Text(
                name.replacingOccurrences(of: "([a-z0-9])([A-Z])", with: "$1 $2", options: .regularExpression)
                    .capitalized
            )
        } else {
            Text("Standard", bundle: .module)
        }
    }
}
