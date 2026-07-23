//
//  PricedCardRow.swift
//  TCGFeatures
//

import SwiftUI
import TCGClient

struct PricedCardRow: View {
    let card: PricedCard

    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 5) {
                Text(card.name).font(.headline)
                Text("\(card.rarity ?? card.game.title) • \(card.cardNumber)")
                    .foregroundStyle(.secondary)
                marketDetails
            }
            Spacer(minLength: 12)
            VStack(alignment: .trailing, spacing: 4) {
                if let headline = card.headline {
                    Text(headline.amount, format: .currency(code: headline.currency.rawValue))
                        .font(.title3.weight(.semibold).monospacedDigit())
                } else {
                    Text("No price").foregroundStyle(.secondary)
                }
                if let trend = card.market?.trend7d?.trend {
                    Label(trend.title, systemImage: trend.systemImage)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(TrendColor.color(for: trend))
                        .labelStyle(.iconOnly)
                        .accessibilityLabel(trend.title)
                }
            }
        }
        .padding(.vertical, 6)
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private var marketDetails: some View {
        if let market = card.market,
            market.market != nil || market.trend7d != nil || market.trend30d != nil
        {
            HStack(spacing: 12) {
                if let amount = market.market {
                    Text("Market \(amount, format: .currency(code: market.currency.rawValue))")
                }
                if let movement = market.trend7d {
                    Text("7d \(movement.percentChange / 100, format: .percent.precision(.fractionLength(1)))")
                }
                if let movement = market.trend30d {
                    Text("30d \(movement.percentChange / 100, format: .percent.precision(.fractionLength(1)))")
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
