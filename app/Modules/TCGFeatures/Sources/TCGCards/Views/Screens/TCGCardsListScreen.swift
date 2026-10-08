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
    @Environment(TCGCards.self) private var cardCollection

    @State private var model: TCGCardsListScreenModel

    public init() {
        _model = State(initialValue: TCGCardsListScreenModel())
    }

    init(model: TCGCardsListScreenModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        content
            .overlay { if cardCollection.isLoading { ProgressView() } }
            .navigationTitle("My collection")
            .toolbar {
                Button {
                    model.presentedForm = .add
                } label: {
                    Label("Add card", systemImage: "plus")
                }
            }
            .sheet(item: $model.presentedForm) { route in
                NavigationStack {
                    switch route {
                    case .add: TCGCardFormScreen(model: .init(mode: .add, initialValues: nil))
                    case .detail(let card): TCGCardDetailScreen(model: .init(card: card))
                    }
                }
            }
            .cardImage(url: $model.presentedImageURL)
            .task(id: model.filters) {
                await model.resumeLoadIfNeeded(using: cardCollection)
            }
            .toast(model.toast, dismiss: model.dismissToast)
    }

    @ViewBuilder
    private var content: some View {
        #if os(macOS)
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 16) {
                    gameFilterMenu
                    collectionRows
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
                        .onDelete { offsets in
                            Task { await model.delete(at: offsets, using: cardCollection) }
                        }
                }
            }
        #endif
    }

    private var gameFilterBinding: Binding<CardGame?> {
        Binding(
            get: { model.gameFilter.map(CardGame.init(client:)) },
            set: { model.gameFilter = $0?.clientGame }
        )
    }

    private var gameFilterMenu: some View {
        TCGFilterMenu(gameTitle: gameFilterTitle, summary: TCGSetFilterSection.summary(for: model.setNames)) {
            Picker(selection: gameFilterBinding) {
                Text("All games", bundle: .module).tag(CardGame?.none)
                ForEach(CardGame.allCases, id: \.self) { game in
                    Text(verbatim: game.title).tag(Optional(game))
                }
            } label: {
                Text("Game", bundle: .module)
            }
            TCGSetFilterSection(
                availableSetNames: model.availableSetNames(using: cardCollection),
                selection: $model.setNames
            )
        }
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
                    #if os(macOS)
                        .padding(12)
                        .background(.background.secondary, in: RoundedRectangle(cornerRadius: 12))
                        .contextMenu {
                            Button("Delete", systemImage: "trash", role: .destructive) {
                                Task { await model.delete(cardWithPrice.card, using: cardCollection) }
                            }
                        }
                    #endif
            }
        }
    }

    private var cardRows: some DynamicViewContent {
        ForEach(cardCollection.cards, id: \.card.id) { cardWithPrice in
            cardButton(for: cardWithPrice)
        }
    }

    @ViewBuilder
    private var emptyCollection: some View {
        if model.gameFilter != nil || !model.setNames.isEmpty {
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
        CardRow(
            cardWithPrice: cardWithPrice,
            showDetails: { model.showDetails(of: cardWithPrice) },
            exploreImage: { model.exploreImage(of: cardWithPrice) }
        )
    }

}
