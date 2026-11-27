import KamaalExtensions
import KamaalUI
import SwiftUI
import TCGClient
import TCGCurrency
import TCGDesignSystem
import TCGWishlist

public struct TCGWishlistScreen<AddForm: View>: View {
    @Environment(\.tcgWishlist) private var wishlist
    @Environment(\.tcgCurrency) private var currency
    @Environment(\.tcgPricePrivacy) private var pricePrivacy
    @Environment(\.scenePhase) private var scenePhase
    @State private var model: TCGWishlistScreenModel

    private let isVisible: Bool
    private let addForm: (PricedCard, @escaping () -> Void) -> AddForm

    public init(isVisible: Bool, @ViewBuilder addForm: @escaping (PricedCard, @escaping () -> Void) -> AddForm) {
        self.init(isVisible: isVisible, model: TCGWishlistScreenModel(preferences: .standard), addForm: addForm)
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
                guard let loadIdentity else { return }
                await model.search(using: wishlist, currency: loadIdentity.display?.currency)
            }
            .refreshable { await model.refresh(using: wishlist, currency: currency?.preferredCurrency) }
            .sheet(item: $model.selected) { card in
                TCGSearchDetailView(
                    card: model.entries.first { $0.printingKey == card.printingKey } ?? card,
                    variants: [],
                    isWishlistEntry: true,
                    onWishlistRemoval: { model.didRemove(card) },
                    addForm: addForm
                )
            }
            .wishlistFeedback($model.feedback)
    }

    private var wishlistList: some View {
        @Bindable var filterState = model.filterState
        return TCGCollectionList(
            title: Text("Wishlist", bundle: .module),
            query: $filterState.query,
            hidesScrollBackground: false,
            showsEmptyContent: model.entries.isEmpty && model.hasLoaded && model.cursor == nil && model.error == nil
        ) {
            TCGCollectionFilters(
                state: filterState,
                availableSets: model.availableSetNames,
                availableIllustrators: model.availableIllustrators
            )
        } rows: {
            if model.entries.isEmpty && !model.hasLoaded && (model.error == nil || model.isLoading) {
                ProgressView()
            }
            ForEach(model.entries) { card in
                wishlistRow(card)
                    .task(id: paginationCursor(for: card)) {
                        guard paginationCursor(for: card) != nil else { return }
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
        let filters: CardListFilters
        let display: TCGCurrency.DisplayIdentity?
        let revision: UUID?
    }

    private var loadIdentity: LoadIdentity? {
        guard isVisible, scenePhase == .active else { return nil }
        return LoadIdentity(
            filters: model.filterState.filters,
            display: currency?.displayIdentity,
            revision: wishlist?.revision
        )
    }

    private func paginationCursor(for card: PricedCard) -> String? {
        guard isVisible, scenePhase == .active, !model.isRefreshing, card.id == model.entries.last?.id else {
            return nil
        }
        return model.cursor
    }

    @ViewBuilder
    private var emptyWishlist: some View {
        if model.filterState.filters.isActive {
            TCGCollectionNoMatches()
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
                HStack(alignment: .top, spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(card.name).font(.headline)
                        Text(
                            [card.setName, card.cardNumber, card.variantName].unpacked().joined(separator: " · ")
                        )
                        .foregroundStyle(.secondary)
                    }
                    .ktakeWidthEagerly(alignment: .leading)
                    if pricePrivacy?.hidePrices != true {
                        if let currency, let display = card.display,
                            display.preferredCurrency != currency.preferredCurrency
                        {
                            if model.isLoading { ProgressView() }
                        } else {
                            CardHeadlinePrice(card: card)
                        }
                    }
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .tcgCollectionListRow()
    }
}
