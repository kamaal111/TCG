//
//  TCGCardsListScreen.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/20/26.
//

import SwiftUI
import TCGClient
import TCGCurrency
import TCGDesignSystem
import TCGModels

public struct TCGCardsListScreen: View {
    @Environment(\.tcgPricePrivacy) private var pricePrivacy
    @Environment(\.tcgCollections) private var collections
    @Environment(TCGCards.self) private var cardCollection

    @State private var model: TCGCardsListScreenModel

    private let hidesScrollBackground: Bool

    public init() {
        self.init(model: TCGCardsListScreenModel(preferences: .standard), hidesScrollBackground: false)
    }

    init(model: TCGCardsListScreenModel, hidesScrollBackground: Bool) {
        _model = State(initialValue: model)
        self.hidesScrollBackground = hidesScrollBackground
    }

    public var body: some View {
        content
            .sheet(item: $model.presentedForm) { route in
                switch route {
                case .detail(let card): TCGCardDetailScreen(model: .init(card: card))
                case .edit(let card): TCGCardFormScreen(model: .init(editing: card))
                }
            }
            .alert(
                Text("Delete card?", bundle: .module),
                isPresented: isConfirmingDeletion,
                presenting: model.cardToDelete
            ) { card in
                Button(role: .destructive) {
                    Task { await model.delete(card, using: cardCollection) }
                } label: {
                    Text("Delete", bundle: .module)
                }
                Button(role: .cancel) {
                } label: {
                    Text("Cancel", bundle: .module)
                }
            } message: { card in
                Text("Delete all saved copies of \(card.name)?", bundle: .module)
            }
            .cardImage(url: $model.presentedImageURL)
            .task(id: model.filters) {
                await model.resumeLoadIfNeeded(using: cardCollection)
            }
            .toast(model.toast, type: .error, dismiss: model.dismissToast)
            .onChange(of: cardCollection.displayRefreshError) { _, error in
                if let error { model.show(error) }
            }
    }

    private var isConfirmingDeletion: Binding<Bool> {
        Binding(
            get: { model.cardToDelete != nil },
            set: { if !$0 { model.cardToDelete = nil } }
        )
    }

    private var deleteCards: ((IndexSet) -> Void)? {
        guard !cardCollection.isReadOnly, !model.isMutatingCard else { return nil }
        return { offsets in
            Task { await model.delete(at: offsets, using: cardCollection) }
        }
    }

    private var collectionTitle: String {
        guard let collection = cardCollection.selectedCollection else {
            return String(localized: "All cards", bundle: .module)
        }
        return collection.isUnfiled ? String(localized: "Unfiled", bundle: .module) : collection.name
    }

    private var content: some View {
        collectionList
            .collectionPriceStatus(
                isVisible: cardCollection.isLoadingPrices && cardCollection.nextPageError == nil
                    && cardCollection.displayRefreshError == nil && pricePrivacy?.hidePrices != true,
                bottomInset: 8
            )
    }

    private var collectionList: some View {
        @Bindable var filterState = model.filterState
        return TCGCollectionList(
            title: Text(verbatim: collectionTitle),
            query: $filterState.query,
            hidesScrollBackground: hidesScrollBackground,
            showsEmptyContent: cardCollection.cards.isEmpty && cardCollection.hasLoadedCurrentCollection
                && !cardCollection.hasMoreCards
        ) {
            TCGCollectionFilters(
                state: filterState,
                availableSets: cardCollection.availableSetNames,
                availableIllustrators: cardCollection.availableIllustrators
            )
        } rows: {
            #if os(macOS)
                cardRows
            #else
                cardRows.onDelete(perform: deleteCards)
            #endif
        } emptyContent: {
            emptyCollection
        } footer: {
            if cardCollection.hasMoreCards {
                TCGScrollPaginationTrigger(pageID: cardCollection.nextScrollPage) { pageID in
                    Task {
                        guard cardCollection.nextScrollPage == pageID else { return }
                        _ = await cardCollection.loadNextPage()
                    }
                }
            }
            TCGCollectionPaginationFooter(
                isLoading: cardCollection.isLoadingNextPage,
                errorDescription: cardCollection.nextPageError?.errorDescription,
                failureTitle: nil,
                retry: { Task { _ = await cardCollection.loadNextPage() } }
            )
        }
    }

    private var cardRows: some DynamicViewContent {
        ForEach(cardCollection.cards, id: \.card.id) { cardWithPrice in
            cardButton(for: cardWithPrice)
                .tcgCollectionListRow()
        }
    }

    @ViewBuilder
    private var emptyCollection: some View {
        if model.filters.isActive {
            TCGCollectionNoMatches()
        } else {
            ContentUnavailableView(
                "No cards",
                systemImage: "rectangle.stack.badge.plus",
                description: Text("Find a printing in Search or Wishlist to add your first card.", bundle: .module)
            )
        }
    }

    private func cardButton(for cardWithPrice: CardWithPrice) -> some View {
        VStack(alignment: .leading) {
            CardRow(
                cardWithPrice: cardWithPrice,
                showDetails: { model.showDetails(of: cardWithPrice) },
                exploreImage: { model.exploreImage(of: cardWithPrice) }
            )
            if let collection = cardCollection.selectedCollection {
                let total = cardWithPrice.card.totalQuantity
                let unplaced = max(0, total - collection.allocatedCopies(of: cardWithPrice.card.id))
                Text("\(unplaced) unplaced", bundle: .module).font(.caption).foregroundStyle(.secondary)
            }
        }
        .contentShape(Rectangle())
        .contextMenu {
            Button {
                model.showDetails(of: cardWithPrice)
            } label: {
                Label {
                    Text("View", bundle: .module)
                } icon: {
                    Image(systemName: "eye")
                }
            }
            if !cardCollection.isReadOnly {
                Button {
                    model.showEdit(for: cardWithPrice)
                } label: {
                    Label {
                        Text("Edit", bundle: .module)
                    } icon: {
                        Image(systemName: "pencil")
                    }
                }
                .disabled(model.isMutatingCard)
                collectionMenu(for: cardWithPrice.card)
                Button(role: .destructive) {
                    model.cardToDelete = cardWithPrice.card
                } label: {
                    Label {
                        Text("Delete", bundle: .module)
                    } icon: {
                        Image(systemName: "trash")
                    }
                }
                .disabled(model.isMutatingCard)
            }
        }
    }

    private func collectionMenu(for card: Card) -> some View {
        let destinations = model.destinations(for: card, in: collections?.collections ?? [])
        return Menu {
            ForEach(destinations) { destination in
                Button {
                    Task { await model.move(card, to: destination, using: cardCollection) }
                } label: {
                    CollectionTitle(collection: destination)
                }
            }
        } label: {
            if card.collectionID == nil {
                Label {
                    Text("Add to collection", bundle: .module)
                } icon: {
                    Image(systemName: "folder.badge.plus")
                }
            } else {
                Label {
                    Text("Move to another collection", bundle: .module)
                } icon: {
                    Image(systemName: "folder")
                }
            }
        }
        .disabled(destinations.isEmpty || model.isMutatingCard)
    }
}
