//
//  CardRow.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/20/26.
//

import KamaalExtensions
import SwiftUI
import TCGClient

struct CardRow: View {
    let cardWithPrice: CardWithPrice

    var body: some View {
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
            }
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
    }

    private var amountOfCards: Int {
        cardWithPrice.card.quantities.sum(by: \.quantity)
    }
}
