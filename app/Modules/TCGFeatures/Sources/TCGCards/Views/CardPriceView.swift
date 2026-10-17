//
//  CardPriceView.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/20/26.
//

import SwiftUI
import TCGClient
import TCGCurrency

struct CardPriceView: View {
    @Environment(\.tcgCurrency) private var currencyState
    let price: OwnedCardPrice?

    var body: some View {
        if let target = currencyState?.preferredCurrency, let card = price?.price,
            card.display?.preferredCurrency != target
        {
            ProgressView()
        } else if let headline = price?.price?.displayHeadline, price?.status == .priced {
            CurrencyAmount(
                headline.amount,
                currency: headline.currency,
                conversionUnavailable: price?.price?.conversionUnavailable ?? false
            )
            .font(.subheadline.weight(.semibold).monospacedDigit())
        } else if price?.status == .unavailable {
            Label {
                Text("Couldn’t load price", bundle: .module)
            } icon: {
                Image(systemName: "exclamationmark.triangle")
            }
            .font(.subheadline)
            .foregroundStyle(.orange)
            .fixedSize(horizontal: false, vertical: true)
        } else {
            Text(price?.status == .noPrice ? "No price" : "—")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
    }
}
