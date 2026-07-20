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
            Text("×\(card.quantities.reduce(0) { $0 + $1.quantity })")
                .font(.title3.monospacedDigit())
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
    }
}
