import Foundation
import TCGClient

package struct CardVariantGroup: Identifiable {
    private enum Key: Hashable {
        case printedNumber(String)
        case pricedCard(String)
    }

    package let card: PricedCard
    package let variants: [PricedCard]

    package init(card: PricedCard, variants: [PricedCard]) {
        self.card = card
        self.variants = variants
    }

    package var id: String { card.id }

    package var collageURLs: [URL] {
        var seen = Set<URL>()
        var preview: [URL] = []
        for variant in variants {
            guard let url = variant.imageURL, seen.insert(url).inserted else { continue }
            preview.append(url)
            if preview.count == 4 { break }
        }
        return preview.count == 3 ? Array(preview.prefix(2)) : preview
    }

    package var hasArtwork: Bool { variants.contains { $0.imageURL != nil } }

    package var canExploreAlternativeArtwork: Bool {
        card.imageURL == nil && variants.count > 1 && hasArtwork
    }

    package var directArtworkURL: URL? { variants.count == 1 ? variants.first?.imageURL : nil }

    package func artworkURL(for variantID: String) -> URL? {
        variants.first { $0.id == variantID }?.imageURL
    }

    package func destinationCard(selected: PricedCard?) -> PricedCard? {
        variants.count < 2 ? card : selected
    }

    package static func group(_ cards: [PricedCard]) -> [CardVariantGroup] {
        let groups = Dictionary(grouping: cards, by: key)
        var seen = Set<Key>()
        return cards.compactMap { card in
            let key = key(for: card)
            guard seen.insert(key).inserted, let variants = groups[key] else { return nil }
            return CardVariantGroup(card: card, variants: variants)
        }
    }

    private static func key(for card: PricedCard) -> Key {
        guard card.game == .onePiece else { return .pricedCard(card.id) }
        return .printedNumber(card.cardNumber.split(whereSeparator: \.isWhitespace).joined(separator: " ").uppercased())
    }
}
