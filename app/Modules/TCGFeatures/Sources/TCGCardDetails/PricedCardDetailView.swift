import SwiftUI
import TCGClient
import TCGDesignSystem
import TCGWishlist

package struct PricedCardDetailView<Header: View, PriceFallback: View, AddForm: View>: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.tcgWishlist) private var wishlist
    @State private var wishlistModel: WishlistDetailModel
    @State private var cardToAdd: PricedCard?
    @State private var didAddCard = false
    @State private var imageGroup: CardVariantGroup?

    private let originalCard: PricedCard
    private let group: CardVariantGroup
    private let displayedCard: PricedCard?
    private let isWishlistEntry: Bool
    private let onWishlistRemoval: (() -> Void)?
    private let onWishlistMembershipChange: (String, Bool) -> Void
    private let addForm: (PricedCard, @escaping () -> Void) -> AddForm
    private let header: () -> Header
    private let priceFallback: () -> PriceFallback

    package init(
        originalCard: PricedCard,
        group: CardVariantGroup,
        displayedCard: PricedCard?,
        isWishlistEntry: Bool,
        onWishlistRemoval: (() -> Void)?,
        onWishlistMembershipChange: @escaping (String, Bool) -> Void,
        addForm: @escaping (PricedCard, @escaping () -> Void) -> AddForm,
        @ViewBuilder header: @escaping () -> Header,
        @ViewBuilder priceFallback: @escaping () -> PriceFallback
    ) {
        self.originalCard = originalCard
        self.group = group
        self.displayedCard = displayedCard
        self.isWishlistEntry = isWishlistEntry
        self.onWishlistRemoval = onWishlistRemoval
        self.onWishlistMembershipChange = onWishlistMembershipChange
        self.addForm = addForm
        self.header = header
        self.priceFallback = priceFallback
        _wishlistModel = State(initialValue: WishlistDetailModel(isWishlistEntry: isWishlistEntry))
    }

    package var body: some View {
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
            .modifier(CardArtworkPresentation(group: $imageGroup))
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
            header()
            if group.canExploreAlternativeArtwork {
                Button {
                    imageGroup = group
                } label: {
                    Text("Explore variant artwork", bundle: .module)
                }
                .padding(.vertical, 8)
            }
            CardDetailContent(
                metadata: .init(card: displayedCard ?? group.card),
                price: displayedCard,
                ownedQuantities: nil
            ) {
                if displayedCard == nil && !isWishlistEntry {
                    priceFallback()
                }
            }
        }
    }

    private var wishlistButton: (some View)? {
        let isWishlisted: Bool? =
            if wishlist != nil, originalCard.printingKey != nil {
                wishlistModel.isWishlisted ?? group.card.isWishlisted
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
            title: Text("Add \(originalCard.name) to collection", bundle: .module),
            isLoading: false
        ) {
            cardToAdd = displayedCard ?? group.card
        }
        .disabled(wishlistModel.isWorking)
    }

    private func addFormDismissed() {
        guard didAddCard else { return }
        didAddCard = false
        if wishlist == nil || !wishlistModel.prepareAcquisition(for: group.card) { dismiss() }
    }

    private func runWishlistAction(_ action: WishlistDetailModel.Action) {
        wishlistModel.run(action, for: group.card, using: wishlist) { outcome in
            switch outcome {
            case .removed:
                didRemoveFromWishlist()
                dismiss()
            case .membershipChanged(let saved):
                if let key = originalCard.printingKey { onWishlistMembershipChange(key, saved) }
            }
        }
    }

    private func didRemoveFromWishlist() {
        if let key = originalCard.printingKey { onWishlistMembershipChange(key, false) }
        onWishlistRemoval?()
    }
}
