//
//  TCGSearchScreen.swift
//  TCGFeatures
//

import SwiftUI
import TCGClient
import TCGDesignSystem

public struct TCGSearchScreen: View {
    @Environment(TCGSearch.self) private var search
    @State private var model: TCGSearchScreenModel

    public init() {
        _model = State(initialValue: TCGSearchScreenModel())
    }

    init(model: TCGSearchScreenModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        content
            .navigationTitle("Card search")
            .searchable(text: $model.query, prompt: "Card name or number")
            .onSubmit(of: .search) { Task { await model.performSearch(using: search) } }
            .onChange(of: model.query) { _, _ in model.scheduleSearch(using: search) }
            .onChange(of: model.game) { _, _ in model.scheduleSearch(using: search) }
            .toast(model.toast, dismiss: model.dismissToast)
    }

    @ViewBuilder
    private var content: some View {
        #if os(macOS)
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 16) {
                    gamePicker
                    searchResults
                }
                .padding(24)
            }
        #else
            List {
                gamePicker
                searchResults
            }
        #endif
    }

    private var gamePicker: some View {
        Picker("Game", selection: $model.game) {
            ForEach(CardGame.allCases, id: \.self) { game in
                Text(game.title).tag(game)
            }
        }
        .pickerStyle(.segmented)
    }

    @ViewBuilder
    private var searchResults: some View {
        if search.isSearching {
            HStack {
                Spacer()
                ProgressView("Searching…")
                Spacer()
            }
            #if !os(macOS)
                .listRowSeparator(.hidden)
            #endif
        } else if model.query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            emptySearch
        } else if search.status == .noResults {
            noResults
        } else {
            ForEach(search.results) { card in
                PricedCardRow(card: card)
                    #if os(macOS)
                        .padding(12)
                        .background(.background.secondary, in: RoundedRectangle(cornerRadius: 12))
                    #endif
            }
        }
    }

    private var emptySearch: some View {
        ContentUnavailableView(
            "Search cards",
            systemImage: "magnifyingglass",
            description: Text("Enter a card name or number to see current market pricing.")
        )
        #if os(macOS)
            .frame(maxWidth: .infinity, minHeight: 480)
        #else
            .listRowSeparator(.hidden)
        #endif
    }

    private var noResults: some View {
        ContentUnavailableView(
            "No match",
            systemImage: "rectangle.and.text.magnifyingglass",
            description: Text("No match — try adding the set number, e.g. Charizard 199.")
        )
        #if os(macOS)
            .frame(maxWidth: .infinity, minHeight: 480)
        #else
            .listRowSeparator(.hidden)
        #endif
    }
}
