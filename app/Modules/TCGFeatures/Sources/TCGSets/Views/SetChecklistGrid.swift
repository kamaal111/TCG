import SwiftUI
import TCGClient
import TCGDesignSystem

struct SetChecklistGrid: View {
    @Environment(\.dynamicTypeSize) private var typeSize
    let cards: [CatalogSetCard]
    let onSelect: (CatalogSetCard) -> Void

    var body: some View {
        LazyVGrid(
            columns: [GridItem(.adaptive(minimum: typeSize.isAccessibilitySize ? 145 : 105), spacing: 12)],
            spacing: 16
        ) {
            ForEach(cards) { card in
                Button {
                    onSelect(card)
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        artwork(for: card)
                        Text(card.name)
                            .font(.caption)
                            .lineLimit(2)
                        Text(card.printedNumber)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.plain)
                .accessibilityElement(children: .combine)
                .accessibilityValue(
                    card.owned ? CatalogChecklistFilter.owned.title : CatalogChecklistFilter.missing.title
                )
            }
        }
    }

    private func artwork(for card: CatalogSetCard) -> some View {
        RoundedRectangle(cornerRadius: 6)
            .fill(.quaternary)
            .aspectRatio(0.72, contentMode: .fit)
            .overlay {
                GeometryReader { geometry in
                    CardArtworkView(thumbnailURL: card.imageURL)
                        .frame(width: geometry.size.width, height: geometry.size.height)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .compositingGroup()
            .grayscale(card.owned ? 0 : 1)
            .opacity(card.owned ? 1 : 0.6)
            .overlay(alignment: .topTrailing) {
                if card.owned {
                    Image(systemName: "checkmark.circle.fill")
                        .symbolRenderingMode(.palette)
                        .foregroundStyle(.white, .green)
                        .padding(6)
                }
            }
            .accessibilityHidden(true)
    }
}
