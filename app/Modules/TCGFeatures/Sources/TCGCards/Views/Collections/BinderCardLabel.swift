import SwiftUI
import TCGClient
import TCGDesignSystem

struct BinderCardLabel: View {
    let card: CardWithPrice

    var body: some View {
        HStack(spacing: 12) {
            CardImageView(url: card.price.price?.imageURL)
            VStack(alignment: .leading, spacing: 4) {
                Text(verbatim: card.card.name).font(.headline)
                Text(verbatim: "\(card.card.setName) • \(card.card.cardNumber)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .multilineTextAlignment(.leading)
        }
    }
}
