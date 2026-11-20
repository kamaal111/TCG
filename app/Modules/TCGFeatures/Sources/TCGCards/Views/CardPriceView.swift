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
            card.display?.preferredCurrency != target,
            card.conditionValues == nil || card.display != nil
        {
            ProgressView()
        } else if let valuation = price?.valuation {
            VStack(alignment: .trailing, spacing: 2) {
                CurrencyAmount(
                    valuation.amount,
                    currency: valuation.currency,
                    label: nil,
                    conversionUnavailable: valuation.conversionUnavailable
                )
                .font(.subheadline.weight(.semibold).monospacedDigit())
                Group {
                    if valuation.estimated {
                        Text("Estimated total", bundle: .module)
                    } else {
                        Text("Total", bundle: .module)
                    }
                }
                .font(.caption2)
                .foregroundStyle(.secondary)
            }
        } else if price?.price?.conditionValues == nil, let headline = price?.price?.displayHeadline,
            price?.status == .priced
        {
            CurrencyAmount(
                headline.amount,
                currency: headline.currency,
                label: nil,
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
        } else if price?.status == .priced {
            Text("Total unavailable", bundle: .module)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        } else {
            Text(price?.status == .noPrice ? "No price" : "—")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
    }
}
