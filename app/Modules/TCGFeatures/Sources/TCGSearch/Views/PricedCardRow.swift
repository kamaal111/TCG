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
                averages
            }
            Spacer(minLength: 12)
            VStack(alignment: .trailing, spacing: 4) {
                if let headline = card.headline {
                    Text(headline.amount, format: .currency(code: headline.currency))
                        .font(.title3.weight(.semibold).monospacedDigit())
                } else {
                    Text("No price").foregroundStyle(.secondary)
                }
                if let trend = card.cardmarket?.trend {
                    Label(trend.title, systemImage: trend.systemImage)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(trend.color)
                        .labelStyle(.iconOnly)
                        .accessibilityLabel(trend.title)
                }
            }
        }
        .padding(.vertical, 6)
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private var averages: some View {
        if let cardmarket = card.cardmarket,
            cardmarket.average7d != nil || cardmarket.average30d != nil
        {
            HStack(spacing: 12) {
                if let average = cardmarket.average7d {
                    Text("7d \(average, format: .currency(code: cardmarket.currency))")
                }
                if let average = cardmarket.average30d {
                    Text("30d \(average, format: .currency(code: cardmarket.currency))")
                }
            }
            .font(.caption.monospacedDigit())
            .foregroundStyle(.secondary)
        }
    }
}

extension PriceTrend {
    fileprivate var title: String {
        switch self {
        case .up: String(localized: "Trending up")
        case .down: String(localized: "Trending down")
        case .flat: String(localized: "Price is stable")
        }
    }

    fileprivate var systemImage: String {
        switch self {
        case .up: "arrow.up.right"
        case .down: "arrow.down.right"
        case .flat: "arrow.right"
        }
    }

    fileprivate var color: Color {
        switch self {
        case .up: .green
        case .down: .red
        case .flat: .secondary
        }
    }
}
