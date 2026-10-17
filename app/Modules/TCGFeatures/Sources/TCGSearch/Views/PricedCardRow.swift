//
//  PricedCardRow.swift
//  TCGFeatures
//

import SwiftUI
import TCGClient
import TCGCurrency
import TCGDesignSystem

struct PricedCardRow: View {
    @Environment(\.tcgCurrency) private var currencyState
    let card: PricedCard
    let actions: Actions

    struct Actions {
        let add: () -> Void
        let showDetails: () -> Void
        let exploreImage: () -> Void
    }

    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            Button(action: actions.exploreImage) {
                CardImageView(url: card.imageURL)
            }
            .buttonStyle(.plain)
            .disabled(card.imageURL == nil)
            .accessibilityLabel(Text("Explore image of \(card.name)", bundle: .module))
            VStack(alignment: .trailing, spacing: 8) {
                Button(action: actions.showDetails) {
                    details
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Details for \(card.name)", bundle: .module))
                Button(action: actions.add) {
                    Label {
                        Text("Add", bundle: .module)
                    } icon: {
                        Image(systemName: "plus")
                    }
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .font(.caption)
                .accessibilityLabel(Text("Add \(card.name) to collection", bundle: .module))
            }
        }
        .padding(.vertical, 6)
    }

    private var details: some View {
        HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 5) {
                Text(card.name).font(.headline)
                Text("\(card.rarity ?? card.game.title) • \(card.cardNumber)", bundle: .module)
                    .foregroundStyle(.secondary)
                if pricesAreCurrent { marketDetails }
            }
            Spacer(minLength: 12)
            VStack(alignment: .trailing, spacing: 8) {
                if !pricesAreCurrent {
                    ProgressView()
                } else if let headline = card.displayHeadline {
                    CurrencyAmount(
                        headline.amount,
                        currency: headline.currency,
                        conversionUnavailable: card.conversionUnavailable
                    )
                    .font(.title3.weight(.semibold).monospacedDigit())
                    .fixedSize(horizontal: true, vertical: false)
                } else {
                    Text("No price", bundle: .module).foregroundStyle(.secondary)
                }
                if pricesAreCurrent, let trend = card.displayMarket?.trend7d?.trend {
                    Label(trend.title, systemImage: trend.systemImage)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(TrendColor.color(for: trend))
                        .labelStyle(.iconOnly)
                        .accessibilityLabel(trend.title)
                }
            }
        }
        .contentShape(Rectangle())
    }

    private var pricesAreCurrent: Bool {
        guard let currencyState else { return true }
        return card.display?.preferredCurrency == currencyState.preferredCurrency
    }

    @ViewBuilder
    private var marketDetails: some View {
        if let market = card.displayMarket,
            market.market != nil || market.trend7d != nil || market.trend30d != nil
        {
            HStack(spacing: 12) {
                if let amount = market.market {
                    CurrencyAmount(
                        amount,
                        currency: market.currency,
                        label: String(localized: "Market", bundle: .module),
                        conversionUnavailable: card.conversionUnavailable
                    )
                }
                if let movement = market.trend7d {
                    Text(
                        "7d \(movement.percentChange / 100, format: .percent.precision(.fractionLength(1)))",
                        bundle: .module
                    )
                }
                if let movement = market.trend30d {
                    Text(
                        "30d \(movement.percentChange / 100, format: .percent.precision(.fractionLength(1)))",
                        bundle: .module
                    )
                }
            }
            .font(.caption.monospacedDigit())
            .foregroundStyle(.secondary)
        }
    }
}

private enum TrendColor {
    static func color(for trend: PriceTrend) -> Color {
        switch trend {
        case .up: .green
        case .down: .red
        case .flat: .secondary
        }
    }
}
