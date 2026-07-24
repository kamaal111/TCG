//
//  CardRow.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/20/26.
//

import SwiftUI
import TCGClient

struct CardRow: View {
    let card: Card
    let price: OwnedCardPrice?
    let isLoadingPrice: Bool

    var body: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
                Text(card.name).font(.headline)
                Text("\(card.setName) • \(card.cardNumber)").foregroundStyle(.secondary)
                Text(card.game.title)
                    .font(.caption.weight(.semibold))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(.tint.opacity(0.12), in: Capsule())
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 6) {
                Text("×\(card.quantities.reduce(0) { $0 + $1.quantity })")
                    .font(.title3.monospacedDigit())
                priceView
            }
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private var priceView: some View {
        if isLoadingPrice, price == nil {
            ProgressView()
                .controlSize(.small)
                .accessibilityLabel("Loading price")
        } else if let headline = price?.price?.headline, price?.status == .priced {
            Text(headline.amount, format: .currency(code: headline.currency))
                .font(.subheadline.weight(.semibold).monospacedDigit())
        } else {
            Text(price?.status == .noPrice ? "No price" : "—")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
    }
}
