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
        self.init(model: TCGCardsListScreenModel())
    }

    init(model: TCGCardsListScreenModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        content
            .navigationTitle(Text("Collection"))
            .toolbar {
                ToolbarItem {
                    Button(action: { model.presentedForm = .add }) {
                        Label("Add Card", systemImage: "plus")
                    }
                    .accessibilityIdentifier("addCardButton")
                }
            }
            .sheet(item: Binding(get: { model.presentedForm }, set: { route in model.presentedForm = route })) {
                route in
                formSheet(for: route)
            }
            .task { await model.load(using: cards) }
            .toast(
                isPresented: Binding(
                    get: { model.toast != nil },
                    set: { isPresented in
                        if !isPresented {
                            model.dismissToast()
                        }
                    }
                ),
                style: .bottom(
                    title: model.toast?.title ?? "",
                    type: .error,
                    description: model.toast?.message
                )
            )
    }

    private var content: some View {
        VStack(spacing: 0) {
            Picker("Game filter", selection: gameFilterBinding) {
                Text("All").tag(CardGame?.none)
                ForEach(CardGame.allCases, id: \.self) { game in
                    Text(game.title).tag(CardGame?.some(game))
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal)
            .padding(.vertical, 8)

            if filteredCards.isEmpty && !cards.isLoading {
                ContentUnavailableView(
                    "No cards yet",
                    systemImage: "rectangle.stack",
                    description: Text("Add the first card of your collection with the plus button.")
                )
            } else {
                List {
                    ForEach(filteredCards) { card in
                        Button(action: { model.presentedForm = .edit(card) }) {
                            TCGCardsListRow(card: card)
                        }
                        .buttonStyle(.plain)
                    }
                    .onDelete(perform: deleteCards)
                }
                #if os(iOS)
                    .listStyle(.insetGrouped)
                #endif
            }
        }
    }

    private var filteredCards: [Card] {
        model.filteredCards(cards.cards)
    }

    private var gameFilterBinding: Binding<CardGame?> {
        Binding(get: { model.gameFilter }, set: { gameFilter in model.gameFilter = gameFilter })
    }

    private func formSheet(for route: TCGCardsListScreenModel.CardFormRoute) -> some View {
        NavigationStack {
            TCGCardFormScreen(
                mode: {
                    switch route {
                    case .add: .add
                    case .edit(let card): .edit(card)
                    }
                }()
            )
        }
        #if os(macOS)
            .frame(minWidth: 480, minHeight: 560)
        #endif
    }

    private func deleteCards(at offsets: IndexSet) {
        let cardsToDelete = offsets.map { index in filteredCards[index] }
        Task {
            for card in cardsToDelete {
                await model.delete(card, using: cards)
            }
        }
    }
}

private struct TCGCardsListRow: View {
    let card: Card

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(card.name)
                    .font(.headline)
                Text("\(card.setName) • \(card.cardNumber)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 4) {
                Text(card.game.title)
                    .font(.caption)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(.tint.opacity(0.15), in: Capsule())
                Text("×\(card.totalQuantity)")
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
        }
        .contentShape(Rectangle())
    }
}
