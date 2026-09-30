//
//  TCGSearchScreen.swift
//  TCGFeatures
//

import SwiftUI
import TCGClient
import TCGDesignSystem
import TCGModels

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
            .navigationTitle(Text("Card search", bundle: .module))
            .onChange(of: model.query) { _, _ in model.scheduleSearch(using: search) }
            .onChange(of: model.game) { _, _ in model.scheduleSearch(using: search) }
            .toast(model.toast, dismiss: model.dismissToast)
    }

    @ViewBuilder
    private var content: some View {
        #if os(macOS)
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 16) {
                    TCGGamePicker(selection: gameBinding)
                    TCGSearchInput(query: $model.query, game: model.game) {
                        Task { await model.performSearch(using: search) }
                    }
                    searchResults
                }
                .padding(24)
            }
        #else
            List {
                TCGGamePicker(selection: gameBinding)
                TCGSearchInput(query: $model.query, game: model.game) {
                    Task { await model.performSearch(using: search) }
                }
                .listRowSeparator(.hidden)
                searchResults
            }
        #endif
    }

    private var gameBinding: Binding<CardGame> {
        Binding(
            get: { CardGame(client: model.game) },
            set: { newValue in model.game = newValue.clientGame }
        )
    }

    @ViewBuilder
    private var searchResults: some View {
        if search.isSearching {
            HStack {
                Spacer()
                ProgressView { Text("Searching…", bundle: .module) }
                Spacer()
            }
            #if !os(macOS)
                .listRowSeparator(.hidden)
            #endif
        } else if model.query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            emptySearch
        } else if search.hasSearched && search.results.isEmpty {
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
            label: {
                Label {
                    Text("Search cards", bundle: .module)
                } icon: {
                    Image(systemName: "magnifyingglass")
                }
            },
            description: {
                Text(
                    model.game == .pokemon
                        ? LocalizedStringKey(
                            "Enter a card name, number, or set + number to see current market pricing.")
                        : LocalizedStringKey("Enter a card name or full card number to see current market pricing."),
                    bundle: .module
                )
            }
        )
        #if os(macOS)
            .frame(maxWidth: .infinity, minHeight: 480)
        #else
            .listRowSeparator(.hidden)
        #endif
    }

    private var noResults: some View {
        ContentUnavailableView(
            label: {
                Label {
                    Text("No match", bundle: .module)
                } icon: {
                    Image(systemName: "rectangle.and.text.magnifyingglass")
                }
            },
            description: {
                Text(
                    model.game == .pokemon
                        ? LocalizedStringKey(
                            "Try a name and card number, like Charizard ex 199, or a set and printed number, like sv5m 072/071."
                        )
                        : LocalizedStringKey(
                            "Try a card number, like OP14-069, or a name and card number, like Nami OP01-016."),
                    bundle: .module
                )
            }
        )
        #if os(macOS)
            .frame(maxWidth: .infinity, minHeight: 480)
        #else
            .listRowSeparator(.hidden)
        #endif
    }
}
