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
                    case .add: TCGCardFormScreen(model: .init(mode: .add))
                    case .edit(let card): TCGCardFormScreen(model: .init(mode: .edit(card)))
                    }
                }
            }
            .task { await model.load(using: cardCollection) }
            .onChange(of: model.gameFilter) { _, _ in
                Task { await model.load(using: cardCollection) }
            }
            .toast(model.toast, dismiss: model.dismissToast)
    }

    @ViewBuilder
    private var content: some View {
        #if os(macOS)
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 16) {
                    TCGGamePicker(allGames: gameFilterBinding)
                    collectionRows
                }
                .padding(24)
            }
        #else
            List {
                TCGGamePicker(allGames: gameFilterBinding)

                if cardCollection.cards.isEmpty, !cardCollection.isLoading {
                    emptyCollection
                } else {
                    cardRows
                        .onDelete { offsets in
                            for offset in offsets {
                                Task { await model.delete(cardCollection.cards[offset].card, using: cardCollection) }
                            }
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

    private var emptyCollection: some View {
        ContentUnavailableView(
            "No cards",
            systemImage: "rectangle.stack.badge.plus",
            description: Text("Add your first card to start your collection.")
        )
    }

    private func cardButton(for cardWithPrice: CardWithPrice) -> some View {
        Button(action: { model.presentedForm = .edit(cardWithPrice.card) }) {
            CardRow(cardWithPrice: cardWithPrice)
        }
        .buttonStyle(.plain)
    }
}
