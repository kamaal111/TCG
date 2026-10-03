//
//  CardPriceView.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/20/26.
//

import SwiftUI
import TCGClient

struct CardPriceView: View {
    let price: OwnedCardPrice?

    var body: some View {
        if let headline = price?.price?.headline, price?.status == .priced {
            Text(headline.amount, format: .currency(code: headline.currency.rawValue))
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
