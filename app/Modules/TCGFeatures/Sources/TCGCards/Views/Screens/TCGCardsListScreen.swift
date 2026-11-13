//
//  TCGCardsListScreen.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/20/26.
//

import SwiftUI
import TCGClient
import TCGDesignSystem
import TCGModels

public struct TCGCardsListScreen: View {
    @Environment(\.tcgCollections) private var collections
    @Environment(TCGCards.self) private var cardCollection

    @State private var model: TCGCardsListScreenModel

    private let hidesScrollBackground: Bool

    public init() {
        self.init(model: TCGCardsListScreenModel())
    }

    init(model: TCGCardsListScreenModel, hidesScrollBackground: Bool = false) {
        _model = State(initialValue: model)
        self.hidesScrollBackground = hidesScrollBackground
    }

    public var body: some View {
        keyboardScopedContent
            .toolbar {
                if !cardCollection.isReadOnly {
                    Button {
                        model.presentedForm = .add
                    } label: {
                        Label {
                            Text("Add card", bundle: .module)
                        } icon: {
                            Image(systemName: "plus")
                        }
                    }
                    .help(Text("Add card", bundle: .module))
                }
            }
            .sheet(item: $model.presentedForm) { route in
                NavigationStack {
                    switch route {
                    case .add: TCGCardFormScreen(model: .init(mode: .add, initialValues: nil))
                    case .detail(let card): TCGCardDetailScreen(model: .init(card: card))
                    case .edit(let card): TCGCardFormScreen(model: .init(editing: card))
                    }
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
            .toast(model.toast, dismiss: model.dismissToast)
            .onChange(of: cardCollection.displayRefreshError) { _, error in
                if let error { model.show(error) }
            }
    }

    private var keyboardScopedContent: some View {
        TCGSearchKeyboardScope(query: $model.query, prompt: Text("Search cards", bundle: .module)) {
            content
                .overlay { if cardCollection.isLoading { ProgressView() } }
                .navigationTitle(collectionTitle)
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

    @ViewBuilder
    private var content: some View {
        #if os(macOS)
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 16) {
                    gameFilterMenu
                    collectionRows
                    paginationFooter
                }
                .padding(24)
            }
        #else
            List {
                gameFilterMenu
                    .listRowSeparator(.hidden)

                if cardCollection.cards.isEmpty, !cardCollection.isLoading {
                    emptyCollection
                } else {
                    cardRows
                        .onDelete(perform: deleteCards)
                    paginationFooter
                        .listRowSeparator(.hidden)
                }
            }
            .scrollContentBackground(hidesScrollBackground ? .hidden : .automatic)
        #endif
    }

    private var paginationFooter: some View {
        CollectionPaginationFooter(
            isLoading: cardCollection.isLoadingNextPage,
            error: cardCollection.nextPageError,
            retry: { Task { _ = await cardCollection.loadNextPage() } }
        )
    }

    private func loadNextPageIfNeeded(after card: CardWithPrice) {
        guard card.card.id == cardCollection.cards.last?.card.id else { return }
        guard cardCollection.nextPageError == nil else { return }
        guard cardCollection.hasMoreCards else { return }

        Task { _ = await cardCollection.loadNextPage() }
    }

    private var gameFilterBinding: Binding<CardGame?> {
        Binding(
            get: { model.gameFilter.map(CardGame.init(client:)) },
            set: { model.gameFilter = $0?.clientGame }
        )
    }

    private var gameFilterMenu: some View {
        TCGFilterMenu(gameTitle: gameFilterTitle, summary: filterSummary) {
            Picker(selection: gameFilterBinding) {
                Text("All games", bundle: .module).tag(CardGame?.none)
                ForEach(CardGame.allCases, id: \.self) { game in
                    Text(verbatim: game.title).tag(Optional(game))
                }
            } label: {
                Text("Game", bundle: .module)
            }
            if model.gameFilter != .onePiece && !model.availableIllustrators(using: cardCollection).isEmpty {
                Menu {
                    ForEach(model.availableIllustrators(using: cardCollection), id: \.self) { name in
                        Toggle(
                            isOn: Binding(
                                get: { model.illustrators.contains(name) },
                                set: { selected in
                                    if selected {
                                        model.illustrators.insert(name)
                                    } else {
                                        model.illustrators.remove(name)
                                    }
                                }
                            )
                        ) { Text(verbatim: name) }
                    }
                } label: {
                    Text("Illustrators", bundle: .module)
                }
            }
            TCGSetFilterSection(
                availableSetNames: model.availableSetNames(using: cardCollection),
                selection: $model.setNames,
                presentation: .submenu
            )
        }
    }

    private var filterSummary: Text {
        let sets = TCGSetFilterSection.summary(for: model.setNames)
        guard !model.illustrators.isEmpty else { return sets }
        return Text("\(sets) · \(model.illustrators.sorted().joined(separator: ", "))", bundle: .module)
    }

    private var gameFilterTitle: Text {
        guard let game = model.gameFilter else { return Text("All games", bundle: .module) }
        return Text(verbatim: CardGame(client: game).title)
    }

    @ViewBuilder
    private var collectionRows: some View {
        if cardCollection.cards.isEmpty, !cardCollection.isLoading {
            emptyCollection
                .frame(maxWidth: .infinity, minHeight: 480)
        } else {
            ForEach(cardCollection.cards, id: \.card.id) { cardWithPrice in
                cardButton(for: cardWithPrice)
                    .onAppear { loadNextPageIfNeeded(after: cardWithPrice) }
                    #if os(macOS)
                        .padding(12)
                        .background(.background.secondary, in: RoundedRectangle(cornerRadius: 12))
                    #endif
            }
        }
    }

    private var cardRows: some DynamicViewContent {
        ForEach(cardCollection.cards, id: \.card.id) { cardWithPrice in
            cardButton(for: cardWithPrice)
                .onAppear { loadNextPageIfNeeded(after: cardWithPrice) }
        }
    }

    @ViewBuilder
    private var emptyCollection: some View {
        if model.gameFilter != nil || !model.setNames.isEmpty || !model.illustrators.isEmpty
            || model.filters.searchQuery != nil
        {
            ContentUnavailableView {
                Label {
                    Text("No matching cards", bundle: .module)
                } icon: {
                    Image(systemName: "line.3.horizontal.decrease")
                }
            } description: {
                Text("Change your filters to see more cards.", bundle: .module)
            }
        } else {
            ContentUnavailableView(
                "No cards",
                systemImage: "rectangle.stack.badge.plus",
                description: Text("Add your first card to start your collection.")
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
