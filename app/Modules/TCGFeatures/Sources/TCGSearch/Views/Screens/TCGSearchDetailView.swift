import SwiftUI
import TCGClient
import TCGDesignSystem

struct TCGSearchDetailView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var presentedImage: PricedCard?

    let card: PricedCard

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Card details", bundle: .module).font(.headline)
                Spacer()
                Button {
                    dismiss()
                } label: {
                    Text("Done", bundle: .module)
                }
                .keyboardShortcut(.cancelAction)
            }
            .padding()
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    CardArtworkView(url: card.imageURL, onExplore: { presentedImage = card })
                        .frame(maxWidth: .infinity)
                        .frame(height: 280)

                    VStack(alignment: .leading, spacing: 12) {
                        Text(card.name).font(.title.bold()).accessibilityAddTraits(.isHeader)
                        LabeledContent {
                            Text(card.game.title)
                        } label: {
                            Text("Game", bundle: .module)
                        }
                        LabeledContent {
                            Text(card.cardNumber)
                        } label: {
                            Text("Card number", bundle: .module)
                        }
                        if let rarity = card.rarity {
                            LabeledContent {
                                Text(rarity)
                            } label: {
                                Text("Rarity", bundle: .module)
                            }
                        }
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        Text("Pricing", bundle: .module).font(.title2.bold()).accessibilityAddTraits(.isHeader)
                        if let headline = card.headline {
                            price("Lowest Near Mint", amount: headline.amount, currency: headline.currency)
                        }
                        if let market = card.market {
                            LabeledContent {
                                Text(market.condition.title)
                            } label: {
                                Text("Condition", bundle: .module)
                            }
                            if let low = market.low {
                                price("Low", amount: low, currency: market.currency)
                            }
                            if let amount = market.market {
                                price("Market", amount: amount, currency: market.currency)
                            }
                            if let movement = market.trend7d {
                                movementRow("7-day change", movement: movement, currency: market.currency)
                            }
                            if let movement = market.trend30d {
                                movementRow("30-day change", movement: movement, currency: market.currency)
                            }
                        }
                        if card.headline == nil && card.market?.low == nil && card.market?.market == nil {
                            Text("No price", bundle: .module).foregroundStyle(.secondary)
                        }
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        LabeledContent {
                            Text(card.pricedOn, format: .dateTime.year().month().day())
                        } label: {
                            Text("Pricing date", bundle: .module)
                        }
                        LabeledContent {
                            Text(card.fetchedAt, format: .dateTime.year().month().day().hour().minute())
                        } label: {
                            Text("Last fetched", bundle: .module)
                        }
                    }
                    .font(.footnote).foregroundStyle(.secondary)
                }
                .textSelection(.enabled)
                .padding(24)
                .frame(maxWidth: 640)
                .frame(maxWidth: .infinity)
            }
        }
        .background(.background)
        .modifier(SearchImagePresentation(card: $presentedImage))
        #if os(macOS)
            .frame(minWidth: 480, idealWidth: 600, maxWidth: 760, minHeight: 560, idealHeight: 800)
        #endif
    }

    private func price(_ title: LocalizedStringKey, amount: Double, currency: Currency) -> some View {
        LabeledContent {
            Text(amount, format: .currency(code: currency.rawValue)).monospacedDigit()
        } label: {
            Text(title, bundle: .module)
        }
    }

    private func movementRow(_ title: LocalizedStringKey, movement: PriceMovement, currency: Currency) -> some View {
        LabeledContent {
            VStack(alignment: .trailing, spacing: 4) {
                Text(movement.priceChange, format: .currency(code: currency.rawValue))
                Text(movement.percentChange / 100, format: .percent.precision(.fractionLength(1)))
                Label(movement.trend.title, systemImage: movement.trend.systemImage)
                    .font(.caption)
            }
            .monospacedDigit()
        } label: {
            Text(title, bundle: .module)
        }
    }
}
