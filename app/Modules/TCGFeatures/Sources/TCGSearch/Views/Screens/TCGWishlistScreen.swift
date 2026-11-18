import SwiftUI
import TCGClient
import TCGDesignSystem

public struct TCGWishlistScreen<AddForm: View>: View {
    @Environment(\.tcgWishlist) private var wishlist
    @Environment(\.scenePhase) private var scenePhase
    @State private var model: TCGWishlistScreenModel

    private let isVisible: Bool
    private let addForm: (PricedCard, @escaping () -> Void) -> AddForm

    public init(isVisible: Bool, @ViewBuilder addForm: @escaping (PricedCard, @escaping () -> Void) -> AddForm) {
        self.init(isVisible: isVisible, model: TCGWishlistScreenModel(), addForm: addForm)
    }

    init(
        isVisible: Bool,
        model: TCGWishlistScreenModel,
        @ViewBuilder addForm: @escaping (PricedCard, @escaping () -> Void) -> AddForm
    ) {
        self.isVisible = isVisible
        _model = State(initialValue: model)
        self.addForm = addForm
    }

    public var body: some View {
        wishlistList
            .task(id: loadIdentity) {
                guard loadIdentity != nil else { return }
                await model.search(using: wishlist)
            }
            .refreshable { await model.refresh(using: wishlist) }
            .sheet(item: $model.selected) { card in
                TCGSearchDetailView(
                    card: card,
                    isWishlistEntry: true,
                    onWishlistRemoval: { model.didRemove(card) },
                    addForm: addForm
                )
            }
            .wishlistFeedback($model.feedback)
    }

    private var wishlistList: some View {
        @Bindable var model = model
        return TCGCollectionList(
            title: Text("Wishlist", bundle: .module),
            query: $model.query,
            showsEmptyContent: model.entries.isEmpty && model.hasLoaded && model.cursor == nil && model.error == nil
        ) {
            EmptyView()
        } rows: {
            if model.entries.isEmpty && !model.hasLoaded && (model.error == nil || model.isLoading) {
                ProgressView()
            }
            ForEach(model.entries) { card in
                wishlistRow(card)
                    .task(id: card.id == model.entries.last?.id ? model.cursor : nil) {
                        guard isVisible, model.cursor != nil, card.id == model.entries.last?.id else { return }
                        await model.loadNextPage(using: wishlist)
                    }
            }
        } emptyContent: {
            emptyWishlist
        } footer: {
            pagination
        }
    }

    private struct LoadIdentity: Equatable {
        let query: String?
    }

    private var loadIdentity: LoadIdentity? {
        guard isVisible, scenePhase == .active else { return nil }
        return LoadIdentity(query: model.searchQuery)
    }

    @ViewBuilder
    private var emptyWishlist: some View {
        if model.searchQuery != nil {
            ContentUnavailableView {
                Label {
                    Text("No matching cards", bundle: .module)
                } icon: {
                    Image(systemName: "line.3.horizontal.decrease")
                }
            } description: {
                Text("Change your search to see more cards.", bundle: .module)
            }
        } else {
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
    }

    @ViewBuilder
    private var pagination: some View {
        if model.entries.isEmpty, model.cursor != nil, !model.isLoading, model.error == nil {
            Button {
                Task { await model.loadNextPage(using: wishlist) }
            } label: {
                Text("Load more", bundle: .module)
            }
        } else {
            TCGCollectionPaginationFooter(
                isLoading: model.loadingCursor != nil,
                errorDescription: model.isLoading ? nil : model.error?.localizedDescription,
                failureTitle: model.failedCursor == nil ? Text("Couldn't load wishlist", bundle: .module) : nil,
                retry: { Task { await model.retry(using: wishlist) } }
            )
        }
    }

    private func wishlistRow(_ card: PricedCard) -> some View {
        Button {
            model.selected = card
        } label: {
            TCGCollectionRowContent {
                CardImageView(url: card.imageURL)
            } details: {
                VStack(alignment: .leading, spacing: 4) {
                    Text(card.name).font(.headline)
                    Text([card.setName, card.cardNumber, card.variantName].compactMap { $0 }.joined(separator: " · "))
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .tcgCollectionListRow()
    }
}
