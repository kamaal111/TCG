import TCGClient

struct SearchDetailVariantSelection {
    private var variant: PricedCard?

    mutating func select(_ card: PricedCard) {
        variant = card
    }

    func selectedCard(defaultCard: PricedCard, results: [PricedCard]) -> PricedCard {
        let selected = variant ?? defaultCard
        return results.first { $0.id == selected.id } ?? selected
    }
}
