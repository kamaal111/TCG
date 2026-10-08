//
//  CardRow.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/20/26.
//

import KamaalExtensions
import SwiftUI
import TCGClient
import TCGDesignSystem

struct CardRow: View {
    let cardWithPrice: CardWithPrice
    let showDetails: () -> Void
    let exploreImage: () -> Void

    var body: some View {
        HStack(alignment: .top) {
            Button(action: exploreImage) {
                CardImageView(url: cardWithPrice.price.price?.imageURL)
            }
            .buttonStyle(.plain)
            .disabled(cardWithPrice.price.price?.imageURL == nil)
            .accessibilityLabel(Text("Explore image of \(cardWithPrice.card.name)", bundle: .module))
            Button(action: showDetails) {
                details
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("Details for \(cardWithPrice.card.name)", bundle: .module))
        }
        .padding(.vertical, 4)
    }

    private var details: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
                Text(cardWithPrice.card.name).font(.headline)
                Text("\(cardWithPrice.card.setName) • \(cardWithPrice.card.cardNumber)").foregroundStyle(.secondary)
                Text(cardWithPrice.card.game.title)
                    .font(.caption.weight(.semibold))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(.tint.opacity(0.12), in: Capsule())
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 6) {
                Text("×\(amountOfCards)")
                    .font(.title3.monospacedDigit())
                CardPriceView(price: cardWithPrice.price)
                if let change = cardWithPrice.card.purchasePriceChangePercent, abs(change) >= 0.005 {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(change / 100, format: .percent.precision(.fractionLength(0...2)).sign(strategy: .always()))
                            .font(.subheadline.weight(.semibold).monospacedDigit())
                            .foregroundStyle(change > 0 ? .green : .red)
                        Text("vs. purchase · NM market", bundle: .module)
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(
                        Text(
                            "Average near-mint market price changed \(change / 100, format: .percent.precision(.fractionLength(0...2)).sign(strategy: .always())) since purchase",
                            bundle: .module
                        )
                    )
                }
            }
        }
        .frame(maxWidth: .infinity)
        .contentShape(Rectangle())
    }

    private var amountOfCards: Int {
        cardWithPrice.card.quantities.sum(by: \.quantity)
    }
}
