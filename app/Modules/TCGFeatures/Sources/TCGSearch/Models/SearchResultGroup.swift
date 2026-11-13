import Foundation
import TCGClient

struct SearchResultGroup: Identifiable {
    private enum Key: Hashable {
        case printedNumber(String)
        case pricedCard(String)
    }

    let card: PricedCard
    let variants: [PricedCard]

    var id: String { card.id }

    static func group(_ cards: [PricedCard]) -> [SearchResultGroup] {
        let groups = Dictionary(grouping: cards, by: key)
        var seen = Set<Key>()
        return cards.compactMap { card in
            let key = key(for: card)
            guard seen.insert(key).inserted, let variants = groups[key] else { return nil }
            return SearchResultGroup(card: card, variants: variants)
        }
    }

    private static func key(for card: PricedCard) -> Key {
        guard card.game == .onePiece else { return .pricedCard(card.id) }
        return .printedNumber(card.cardNumber.split(whereSeparator: \.isWhitespace).joined(separator: " ").uppercased())
    }
}
