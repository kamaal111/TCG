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

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.scenePhase) private var scenePhase
    @State private var isShowingHistory = false
    @State private var isConfirmingClear = false
    @State private var model: TCGSearchScreenModel

    private let onAdd: (PricedCard) -> Void

    public init(onAdd: @escaping (PricedCard) -> Void) {
        _model = State(initialValue: TCGSearchScreenModel())
        self.onAdd = onAdd
    }

    init(model: TCGSearchScreenModel, onAdd: @escaping (PricedCard) -> Void) {
        _model = State(initialValue: model)
        self.onAdd = onAdd
    }

    public var body: some View {
        content
            .navigationTitle(Text("Card search", bundle: .module))
            .onAppear { model.resumeSearchIfNeeded(using: search) }
            .onDisappear { model.finishEditing(using: search) }
            .onChange(of: scenePhase) { _, phase in
                if phase == .background { model.finishEditing(using: search) }
                if phase == .active { model.resumeSearchIfNeeded(using: search) }
            }
            .navigationDestination(isPresented: $isShowingHistory) {
                TCGSearchHistoryScreen(
                    history: search.history,
                    game: model.game,
                    onSelect: { entry in
                        isShowingHistory = false
                        selectHistory(entry)
                    },
                    onRemove: { model.removeHistory($0, using: search) },
                    onClear: { model.clearHistory(using: search) }
                )
            }
            .confirmationDialog(
                Text("Clear search history?", bundle: .module),
                isPresented: $isConfirmingClear,
                titleVisibility: .visible
            ) {
                Button(role: .destructive) {
                    model.clearHistory(using: search)
                } label: {
                    Text("Clear history", bundle: .module)
                }
                Button(role: .cancel) {
                } label: {
                    Text("Cancel", bundle: .module)
                }
            } message: {
                Text("This removes searches for the selected game from this device.", bundle: .module)
            }
            .toast(model.toast, dismiss: model.dismissToast)
            .sheet(item: $model.presentedDetail) { card in
                TCGSearchDetailView(card: card)
            }
            .modifier(SearchImagePresentation(card: $model.presentedImage))
    }

    @ViewBuilder
    private var content: some View {
        #if os(macOS)
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 16) {
                    TCGSearchInput(
                        query: queryBinding, game: model.game, languages: languagesBinding,
                        gameSelection: gameBinding,
                        availableSetNames: model.availableSetNames(using: search), setNames: $model.setNames,
                        isFocused: $model.isSearchFocused
                    ) {
                        Task { await model.performSearch(using: search) }
                    }
                    historySuggestions
                    searchResults
                }
                .padding(24)
            }
        #else
            List {
                TCGSearchInput(
                    query: queryBinding, game: model.game, languages: languagesBinding,
                    gameSelection: gameBinding,
                    availableSetNames: model.availableSetNames(using: search), setNames: $model.setNames,
                    isFocused: $model.isSearchFocused
                ) {
                    Task { await model.performSearch(using: search) }
                }
                .listRowSeparator(.hidden)
                historySuggestions
                searchResults
            }
        #endif
    }

    private var gameBinding: Binding<CardGame> {
        Binding(
            get: { CardGame(client: model.game) },
            set: { newValue in model.updateGame(newValue.clientGame, using: search) }
        )
    }

    private var languagesBinding: Binding<Set<ClientCardLanguage>> {
        Binding(get: { model.languages }, set: { model.updateLanguages($0, using: search) })
    }

    private var queryBinding: Binding<String> {
        Binding(get: { model.query }, set: { model.updateQuery($0, using: search) })
    }

    private func selectHistory(_ entry: TCGSearchHistoryEntry) {
        Task { await model.selectHistory(entry, using: search) }
    }

    @ViewBuilder
    private var recentSearches: some View {
        if dynamicTypeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 8) {
                recentSearchesTitle
                clearHistoryButton
            }
        } else {
            HStack {
                recentSearchesTitle
                Spacer()
                clearHistoryButton
            }
        }
        TCGSearchHistoryRows(
            entries: Array(search.history.entries(for: model.game).prefix(5)),
            onSelect: selectHistory,
            onRemove: { model.removeHistory($0, using: search) }
        )
        if search.history.entries(for: model.game).count > 5 {
            Button {
                model.finishEditing(using: search)
                isShowingHistory = true
            } label: {
                Text("See all", bundle: .module)
            }
            .buttonStyle(.borderless)
        }
    }

    private var recentSearchesTitle: some View {
        Text("Recent searches", bundle: .module)
            .font(.headline)
    }

    private var clearHistoryButton: some View {
        Button {
            isConfirmingClear = true
        } label: {
            Text("Clear history", bundle: .module)
        }
        .buttonStyle(.borderless)
    }

    @ViewBuilder
    private var historySuggestions: some View {
        let suggestions = search.history.suggestions(for: model.query, game: model.game)
        if model.isSearchFocused && !suggestions.isEmpty {
            Text("Recent searches", bundle: .module)
                .font(.headline)
            TCGSearchHistoryRows(
                entries: suggestions,
                onSelect: selectHistory,
                onRemove: { model.removeHistory($0, using: search) }
            )
        }
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
        }
        if model.query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            if search.history.entries(for: model.game).isEmpty {
                emptySearch
            } else {
                recentSearches
            }
        } else if !search.isSearching && search.hasSearched && search.results.isEmpty {
            noResults
        } else if search.hasSearched && !search.results.isEmpty && model.filteredResults(using: search).isEmpty {
            noMatchingSets
        } else {
            ForEach(model.filteredResults(using: search)) { card in
                PricedCardRow(
                    card: card,
                    actions: .init(
                        add: {
                            model.finishEditing(using: search)
                            onAdd(card)
                        },
                        showDetails: {
                            model.finishEditing(using: search)
                            model.showDetails(of: card)
                        },
                        exploreImage: {
                            model.finishEditing(using: search)
                            model.exploreImage(of: card)
                        }
                    )
                )
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

    private var noMatchingSets: some View {
        ContentUnavailableView {
            Label {
                Text("No matching cards", bundle: .module)
            } icon: {
                Image(systemName: "line.3.horizontal.decrease")
            }
        } description: {
            Text("Change your set filter to see more cards.", bundle: .module)
        }
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
