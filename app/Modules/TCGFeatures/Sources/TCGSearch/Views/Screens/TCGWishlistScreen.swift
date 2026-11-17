import SwiftUI
import TCGClient
import TCGDesignSystem

public struct TCGWishlistScreen<AddForm: View>: View {
    @Environment(\.tcgWishlist) private var wishlist
    @Environment(\.scenePhase) private var scenePhase
    @State private var model = TCGWishlistScreenModel()

    private let isVisible: Bool
    private let addForm: (PricedCard, @escaping () -> Void) -> AddForm

    public init(isVisible: Bool, @ViewBuilder addForm: @escaping (PricedCard, @escaping () -> Void) -> AddForm) {
        self.isVisible = isVisible
        self.addForm = addForm
    }

    public var body: some View {
        List {
            if model.entries.isEmpty && !model.hasLoaded && model.error == nil {
                ProgressView()
            } else if model.entries.isEmpty && !model.hasNextPage && model.error == nil {
                ContentUnavailableView {
                    Label {
                        Text("Your wishlist is empty", bundle: .module)
                    } icon: {
                        Image(systemName: "heart")
                    }
                } description: {
                    Text("Tap the heart in a search result’s details to save the card.", bundle: .module)
                }
            }
            ForEach(model.entries) { card in
                Button {
                    model.selected = card
                } label: {
                    HStack {
                        CardImageView(url: card.imageURL)
                        VStack(alignment: .leading) {
                            Text(card.name)
                            Text(printingDetails(for: card))
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                .buttonStyle(.plain)
            }
            if let error = model.error {
                Text(error.localizedDescription).foregroundStyle(.secondary)
                Button {
                    Task { await model.retry(using: wishlist) }
                } label: {
                    Text("Retry", bundle: .module)
                }
            } else if model.hasNextPage {
                Button {
                    Task { await model.loadNextPage(using: wishlist) }
                } label: {
                    Text("Load more", bundle: .module)
                }
                .disabled(model.isLoading)
            }
        }
        .navigationTitle(Text("Wishlist", bundle: .module))
        .task(id: isVisible && scenePhase == .active) {
            guard isVisible, scenePhase == .active else { return }
            await model.refresh(using: wishlist)
        }
        .refreshable { await model.refresh(using: wishlist) }
        .sheet(item: $model.selected) { card in
            TCGSearchDetailView(
                card: card,
                isWishlistEntry: true,
                onWishlistRemoval: {
                    model.didRemove(card)
                },
                addForm: addForm
            )
        }
        .wishlistFeedback($model.feedback)
    }

    private func printingDetails(for card: PricedCard) -> String {
        [card.setName, card.cardNumber, card.variantName].compactMap { $0 }.joined(separator: " · ")
    }
}
