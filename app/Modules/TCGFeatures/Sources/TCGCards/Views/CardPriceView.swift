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
        } else {
            Text(price?.status == .noPrice ? "No price" : "—")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
    }
}
