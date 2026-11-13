//
//  TCGSearchScreen.swift
//  TCGFeatures
//

import SwiftUI
import TCGClient
import TCGDesignSystem
import TCGModels

public struct TCGSearchScreen<AddForm: View>: View {
    @Environment(TCGSearch.self) private var search

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.scenePhase) private var scenePhase
    @FocusState private var isSearchFocused: Bool
    @State private var isShowingHistory = false
    @State private var isConfirmingClear = false
    @State private var model: TCGSearchScreenModel
    @State private var groupToAdd: SearchResultGroup?

    private let addForm: (PricedCard, @escaping () -> Void) -> AddForm

    public init(@ViewBuilder addForm: @escaping (PricedCard, @escaping () -> Void) -> AddForm) {
        _model = State(initialValue: TCGSearchScreenModel())
        self.addForm = addForm
    }

    init(
        model: TCGSearchScreenModel,
        @ViewBuilder addForm: @escaping (PricedCard, @escaping () -> Void) -> AddForm
    ) {
        _model = State(initialValue: model)
        self.addForm = addForm
    }

    public var body: some View {
        keyboardScopedContent
            .navigationTitle(Text("Card search", bundle: .module))
            .onAppear { model.resumeSearchIfNeeded(using: search) }
            .onDisappear(perform: finishEditing)
            .onChange(of: isSearchFocused) { _, focused in model.isSearchFocused = focused }
            .onChange(of: scenePhase) { _, phase in
                if phase == .background { finishEditing() }
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
            .onChange(of: search.displayRefreshError) { _, error in
                if let error { model.show(error) }
            }
            .sheet(item: $model.presentedDetail) { group in
                TCGSearchDetailView(
                    card: group.card,
                    variants: group.variants,
                    addForm: addForm
                )
            }
            .sheet(item: $groupToAdd) { group in
                SearchResultAddView(card: group.card, variants: group.variants) { card in
                    addForm(card, {})
                }
            }
            .modifier(SearchImagePresentation(group: $model.presentedImage))
    }

    private var keyboardScopedContent: some View {
        TCGSearchKeyboardScope(focus: $isSearchFocused) { focus in
            content(searchFocus: focus)
        }
    }

    @ViewBuilder
    private func content(searchFocus: FocusState<Bool>.Binding) -> some View {
        #if os(macOS)
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 16) {
                    TCGSearchInput(
                        query: queryBinding,
                        mode: modeBinding,
                        game: model.game,
                        languages: languagesBinding,
                        gameSelection: gameBinding,
                        availableSetNames: model.availableSetNames(using: search),
                        setNames: $model.setNames,
                        isFocused: searchFocus
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
                    query: queryBinding,
                    mode: modeBinding,
                    game: model.game,
                    languages: languagesBinding,
                    gameSelection: gameBinding,
                    availableSetNames: model.availableSetNames(using: search),
                    setNames: $model.setNames,
                    isFocused: searchFocus
                ) {
                    Task { await model.performSearch(using: search) }
                }
                .listRowSeparator(.hidden)
                historySuggestions
                searchResults
            }
        #endif
    }

    private var modeBinding: Binding<ClientCardSearchMode> {
        Binding(get: { model.mode }, set: { model.updateMode($0, using: search) })
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
        isSearchFocused = false
        Task { await model.selectHistory(entry, using: search) }
    }

    private func finishEditing() {
        isSearchFocused = false
        model.finishEditing(using: search)
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
                finishEditing()
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
        let suggestions = search.history.suggestions(for: model.query, game: model.game, mode: model.mode)
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
        let visibleResults = model.resultGroups(using: search)
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
        } else if !search.isSearching && search.hasSearched && search.results.isEmpty && search.nextCursor == nil {
            noResults
        } else if search.hasSearched && !search.results.isEmpty && visibleResults.isEmpty {
            noMatchingSets
        } else {
            ForEach(visibleResults) { group in
                PricedCardRow(
                    group: group,
                    actions: .init(
                        add: {
                            finishEditing()
                            groupToAdd = group
                        },
                        showDetails: {
                            finishEditing()
                            model.showDetails(of: group)
                        },
                        exploreImage: {
                            finishEditing()
                            model.exploreImage(of: group)
                        }
                    )
                )
                #if os(macOS)
                    .padding(12)
                    .background(.background.secondary, in: RoundedRectangle(cornerRadius: 12))
                #endif
            }
            if !search.isSearching, let cursor = search.nextCursor {
                paginationFooter(cursor: cursor, canLoadAutomatically: !visibleResults.isEmpty)
                    .frame(maxWidth: .infinity)
            }
        }
    }

    @ViewBuilder
    private func paginationFooter(cursor: String, canLoadAutomatically: Bool) -> some View {
        if search.isLoadingNextPage {
            ProgressView()
        } else if search.didFailToLoadNextPage {
            Button {
                Task { await search.loadNextPage(cursor, retry: true) }
            } label: {
                Text("Retry", bundle: .module)
            }
        } else if !canLoadAutomatically {
            Button {
                Task { await search.loadNextPage(cursor, retry: false) }
            } label: {
                Text("Load more", bundle: .module)
            }
        } else {
            ProgressView()
                .onAppear {
                    Task { await search.loadNextPage(cursor, retry: false) }
                }
                .id(cursor)
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
                    model.mode == .illustrator
                        ? LocalizedStringKey("Try an illustrator name, like Mitsuhiro Arita.")
                        : model.game == .pokemon
                            ? LocalizedStringKey(
                                "Enter a card name, number, or set + number to see current market pricing."
                            )
                            : LocalizedStringKey(
                                "Enter a card name or full card number to see current market pricing."
                            ),
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
        } actions: {
            if !search.isSearching, let cursor = search.nextCursor {
                paginationFooter(cursor: cursor, canLoadAutomatically: false)
            }
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
                    model.mode == .illustrator
                        ? LocalizedStringKey("Try an illustrator name, like Mitsuhiro Arita.")
                        : model.game == .pokemon
                            ? LocalizedStringKey(
                                "Try a name and card number, like Charizard ex 199, or a set and printed number, like sv5m 072/071."
                            )
                            : LocalizedStringKey(
                                "Try a card number, like OP14-069, or a name and card number, like Nami OP01-016."
                            ),
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
