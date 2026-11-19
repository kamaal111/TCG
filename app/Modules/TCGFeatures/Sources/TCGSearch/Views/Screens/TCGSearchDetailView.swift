import SwiftUI
import TCGCardDetails
import TCGClient
import TCGCurrency
import TCGDesignSystem

struct TCGSearchDetailView<AddForm: View>: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.tcgCurrency) private var currencyState
    @Environment(TCGSearch.self) private var search
    @Environment(\.tcgWishlist) private var wishlist
    @State private var wishlistModel: WishlistDetailModel
    @State private var cardToAdd: PricedCard?
    @State private var didAddCard = false
    @State private var imageGroup: SearchResultGroup?

    private let isWishlistEntry: Bool
    private let onWishlistRemoval: (() -> Void)?
    private let card: PricedCard
    private let variants: [PricedCard]
    private let addForm: (PricedCard, @escaping () -> Void) -> AddForm

    init(
        card: PricedCard,
        variants: [PricedCard] = [],
        isWishlistEntry: Bool,
        onWishlistRemoval: (() -> Void)?,
        addForm: @escaping (PricedCard, @escaping () -> Void) -> AddForm
    ) {
        self.isWishlistEntry = isWishlistEntry
        self.onWishlistRemoval = onWishlistRemoval
        _wishlistModel = State(initialValue: WishlistDetailModel(isWishlistEntry: isWishlistEntry))
        self.card = card
        self.variants = variants
        self.addForm = addForm
    }

    var body: some View {
        cardContent
            .tcgSheetWithIconActions(
                Text("Card details", bundle: .module),
                closeLabel: Text("Done", bundle: .module),
                auxiliaryAction: wishlistButton,
                primaryAction: addButton
            )
            .background(.background)
            #if os(macOS)
                .frame(minWidth: 480, idealWidth: 600, maxWidth: 760, minHeight: 560, idealHeight: 800)
            #endif
            .sheet(item: $cardToAdd, onDismiss: addFormDismissed) { card in
                addForm(card) { didAddCard = true }
            }
            .modifier(SearchImagePresentation(group: $imageGroup))
            .wishlistFeedback($wishlistModel.feedback)
            .onDisappear { wishlistModel.cancel() }
            .modifier(
                WishlistAcquisitionPrompt(printingKey: $wishlistModel.acquiredPrintingKey) { removedKey in
                    if removedKey != nil { didRemoveFromWishlist() }
                    dismiss()
                }
            )
            .alert(
                Text("Wishlist unavailable", bundle: .module),
                isPresented: $wishlistModel.showsError
            ) {
                Button {
                    if let action = wishlistModel.retryAction { runWishlistAction(action) }
                } label: {
                    Text("Retry", bundle: .module)
                }
                Button(role: .cancel) {
                } label: {
                    Text("Cancel", bundle: .module)
                }
            } message: {
                Text(wishlistModel.error?.localizedDescription ?? "")
            }
    }

    private var cardContent: some View {
        VStack(spacing: 0) {
            if let exploreVariants {
                Button(action: exploreVariants) {
                    Text("Explore variant artwork", bundle: .module)
                }
                .padding(.vertical, 8)
            }
            CardDetailContent(
                metadata: .init(card: displayedCard ?? selectedCard),
                price: displayedCard
            ) {
                if displayedCard == nil && !isWishlistEntry {
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
            }
        }
    }

    private var wishlistButton: (some View)? {
        let isWishlisted: Bool? =
            if wishlist != nil, card.printingKey != nil {
                wishlistModel.isWishlisted ?? selectedCard.isWishlisted
            } else {
                nil
            }
        return isWishlisted.map { saved in
            TCGSheetIconButton(
                systemImage: saved ? "heart.fill" : "heart",
                title: wishlistActionTitle(saved: saved),
                isLoading: false
            ) {
                runWishlistAction(.init(saved: !saved, dismissAfter: isWishlistEntry))
            }
            .disabled(wishlistModel.isWorking)
        }
    }

    private func wishlistActionTitle(saved: Bool) -> Text {
        saved ? Text("Remove from Wishlist", bundle: .module) : Text("Add to Wishlist", bundle: .module)
    }

    private var addButton: some View {
        TCGSheetIconButton(
            systemImage: "plus",
            title: Text("Add \(card.name) to collection", bundle: .module),
            isLoading: false
        ) {
            cardToAdd = displayedCard ?? selectedCard
        }
        .disabled(wishlistModel.isWorking)
    }

    private func addFormDismissed() {
        guard didAddCard else { return }
        didAddCard = false
        if wishlist == nil || !wishlistModel.prepareAcquisition(for: selectedCard) { dismiss() }
    }

    private func runWishlistAction(_ action: WishlistDetailModel.Action) {
        wishlistModel.run(action, for: selectedCard, using: wishlist) { outcome in
            switch outcome {
            case .removed:
                didRemoveFromWishlist()
                dismiss()
            case .membershipChanged(let saved):
                if let key = card.printingKey { search.setWishlistMembership(saved, for: key) }
            }
        }
    }

    private func didRemoveFromWishlist() {
        if let key = card.printingKey { search.setWishlistMembership(false, for: key) }
        onWishlistRemoval?()
    }

    private var currentVariants: [PricedCard] {
        variants.map { variant in
            Self.latestCard(for: variant, in: search.results)
        }
    }

    private var selectedCard: PricedCard {
        Self.latestCard(for: card, in: search.results)
    }

    static func latestCard(for card: PricedCard, in results: [PricedCard]) -> PricedCard {
        results.first { candidate in
            candidate.id == card.id || (card.printingKey != nil && candidate.printingKey == card.printingKey)
        } ?? card
    }

    private var exploreVariants: (() -> Void)? {
        let group = SearchResultGroup(card: selectedCard, variants: currentVariants)
        guard group.canExploreAlternativeArtwork else { return nil }
        return { imageGroup = group }
    }

    private var displayedCard: PricedCard? {
        guard !isWishlistEntry else { return nil }
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
