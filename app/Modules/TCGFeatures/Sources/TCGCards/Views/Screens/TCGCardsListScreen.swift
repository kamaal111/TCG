//
//  TCGCardsListScreen.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/20/26.
//

import SwiftUI
import TCGClient
import TCGDesignSystem

public struct TCGCardsListScreen: View {
    @Environment(TCGCards.self) private var cards

    @State private var model: TCGCardsListScreenModel

    public init() {
        _model = State(initialValue: TCGCardsListScreenModel())
    }

    init(model: TCGCardsListScreenModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        collection
            .overlay { if cards.isLoading { ProgressView() } }
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
            .task { await model.load(using: cards) }
            .toast(model.toast, dismiss: model.dismissToast)
    }

    @ViewBuilder
    private var collection: some View {
        #if os(macOS)
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 16) {
                    gamePicker
                    collectionRows
                }
                .padding(24)
            }
        #else
            List {
                gamePicker

                if model.filteredCards(cards.cards).isEmpty, !cards.isLoading {
                    emptyCollection
                } else {
                    cardRows
                        .onDelete { offsets in
                            let visible = model.filteredCards(cards.cards)
                            for offset in offsets {
                                Task { await model.delete(visible[offset], using: cards) }
                            }
                        }
                }
            }
        #endif
    }

    private var gamePicker: some View {
        Picker("Game", selection: $model.gameFilter) {
            Text("All games").tag(CardGame?.none)
            ForEach(CardGame.allCases, id: \.self) { game in
                Text(game.title).tag(Optional(game))
            }
        }
        .pickerStyle(.segmented)
    }

    @ViewBuilder
    private var collectionRows: some View {
        if model.filteredCards(cards.cards).isEmpty, !cards.isLoading {
            emptyCollection
                .frame(maxWidth: .infinity, minHeight: 480)
        } else {
            ForEach(model.filteredCards(cards.cards)) { card in
                cardButton(for: card)
                    #if os(macOS)
                        .padding(12)
                        .background(.background.secondary, in: RoundedRectangle(cornerRadius: 12))
                        .contextMenu {
                            Button("Delete", systemImage: "trash", role: .destructive) {
                                Task { await model.delete(card, using: cards) }
                            }
                        }
                    #endif
            }
        }
    }

    private var cardRows: some DynamicViewContent {
        ForEach(model.filteredCards(cards.cards)) { card in
            cardButton(for: card)
        }
    }

    private var emptyCollection: some View {
        ContentUnavailableView(
            "No cards",
            systemImage: "rectangle.stack.badge.plus",
            description: Text("Add your first card to start your collection.")
        )
    }

    private func cardButton(for card: Card) -> some View {
        Button {
            model.presentedForm = .edit(card)
        } label: {
            CardRow(card: card)
        }
        .buttonStyle(.plain)
    }
}
