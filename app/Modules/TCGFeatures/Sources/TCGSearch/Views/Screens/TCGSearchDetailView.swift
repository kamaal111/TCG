import SwiftUI
import TCGCardDetails
import TCGClient
import TCGCurrency

struct TCGSearchDetailView<AddForm: View>: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.tcgCurrency) private var currencyState
    @Environment(\.tcgOpenCatalogSet) private var openCatalogSet
    @Environment(TCGSearch.self) private var search

    let card: PricedCard
    let variants: [PricedCard]
    let isWishlistEntry: Bool
    let onWishlistRemoval: (() -> Void)?
    let addForm: (PricedCard, @escaping () -> Void) -> AddForm

    var body: some View {
        PricedCardDetailView(
            originalCard: card,
            group: .init(card: selectedCard, variants: currentVariants),
            displayedCard: displayedCard,
            isWishlistEntry: isWishlistEntry,
            onWishlistRemoval: onWishlistRemoval,
            onWishlistMembershipChange: { key, saved in search.setWishlistMembership(saved, for: key) },
            addForm: addForm,
            header: { setLinks },
            priceFallback: { priceFallback }
        )
    }

    @ViewBuilder
    private var priceFallback: some View {
        if search.isSearching {
            ProgressView()
        } else {
            Button {
                Task { await search.refresh() }
            } label: {
                Text("Search again for current prices", bundle: .module)
            }
        }
    }

    @ViewBuilder
    private var setLinks: some View {
        if !isWishlistEntry, let openCatalogSet, let sets = selectedCard.catalogSets, !sets.isEmpty {
            if sets.count == 1, let set = sets.first {
                Button(set.name) {
                    openCatalogSet(card.game, set)
                    dismiss()
                }
                .padding(.vertical, 8)
            } else {
                Menu {
                    ForEach(sets) { set in
                        Button(set.name) {
                            openCatalogSet(card.game, set)
                            dismiss()
                        }
                    }
                } label: {
                    Text("View set checklist", bundle: .module)
                }
                .padding(.vertical, 8)
            }
        }
    }

    private var currentVariants: [PricedCard] {
        return variants.map { variant in
            Self.latestCard(for: variant, in: search.results)
        }
    }

    private var selectedCard: PricedCard {
        if isWishlistEntry { return card }
        return Self.latestCard(for: card, in: search.results)
    }

    static func latestCard(for card: PricedCard, in results: [PricedCard]) -> PricedCard {
        results.first { candidate in
            candidate.id == card.id || (card.printingKey != nil && candidate.printingKey == card.printingKey)
        } ?? card
    }

    private var displayedCard: PricedCard? {
        if isWishlistEntry {
            if let currencyState, let display = card.display,
                display.preferredCurrency != currencyState.preferredCurrency
            {
                return nil
            }
            let hasPrice =
                card.headline != nil || card.market != nil || !card.displayConditionPrices.isEmpty
                || card.displayConditionValues?.isEmpty == false
                || !card.displayGradedPrices.isEmpty
            return card.display != nil || hasPrice ? card : nil
        }
        let card = selectedCard
        guard let currencyState else { return card }
        let matches = search.results.filter { $0.display?.preferredCurrency == currencyState.preferredCurrency }
        let exactMatch = matches.first { $0.id == card.id }
        if card.game == .onePiece || card.printingKey != nil { return exactMatch }

        return exactMatch
            ?? matches.first {
                $0.game == card.game && $0.name == card.name && $0.cardNumber == card.cardNumber
                    && $0.setName == card.setName
            }
    }
}
