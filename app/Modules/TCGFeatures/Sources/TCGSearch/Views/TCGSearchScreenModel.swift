//
//  TCGSearchScreenModel.swift
//  TCGFeatures
//

import Foundation
import Observation
import TCGClient
import TCGDesignSystem

@MainActor
@Observable
final class TCGSearchScreenModel {
    var query = ""
    var setNames: Set<String> = []
    var game: ClientCardGame = .pokemon {
        didSet { languages = loadLanguages(for: game) }
    }
    var languages: Set<ClientCardLanguage> = [] {
        didSet {
            preferences?.set(languages.map(\.rawValue).sorted(), forKey: Self.preferenceKey(for: game))
        }
    }

    @ObservationIgnored private let preferences: UserDefaults?

    init(preferences: UserDefaults? = .standard, debounce: Duration = ModuleConfig.searchDebounce) {
        self.preferences = preferences
        self.debounce = debounce
        languages = loadLanguages(for: game)
    }

    private static func preferenceKey(for game: ClientCardGame) -> String {
        "TCGSearch.languages.\(game.rawValue)"
    }

    private func loadLanguages(for game: ClientCardGame) -> Set<ClientCardLanguage> {
        guard let codes = preferences?.stringArray(forKey: Self.preferenceKey(for: game)) else { return [] }
        let parsed = codes.compactMap(ClientCardLanguage.init(rawValue:))
        guard parsed.count == codes.count else { return [] }
        let selection = Set(parsed)
        guard selection.isSubset(of: Set(ClientCardLanguage.supported(for: game))) else { return [] }
        return selection
    }

    var presentedDetail: PricedCard?
    var presentedImage: PricedCard?

    private(set) var toast: Toast?

    func showDetails(of card: PricedCard) {
        presentedDetail = card
    }

    func exploreImage(of card: PricedCard) {
        guard card.imageURL != nil else { return }
        presentedImage = card
    }

    @ObservationIgnored private var searchTask: Task<Void, Never>?
    @ObservationIgnored private var toastTask: Task<Void, Never>?

    var isSearchFocused = false

    @ObservationIgnored private var candidate: (query: String, game: ClientCardGame)?
    @ObservationIgnored private var revision = UUID()
    @ObservationIgnored private let debounce: Duration

    func updateQuery(_ value: String, using search: TCGSearch) {
        let previousQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedQuery = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if previousQuery == normalizedQuery {
            query = value
            return
        }
        if value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            finishEditing(using: search)
        }
        setNames = []
        query = value
        scheduleSearch(using: search)
    }

    func updateGame(_ value: ClientCardGame, using search: TCGSearch) {
        guard value != game else { return }
        finishEditing(using: search)
        setNames = []
        game = value
        scheduleSearch(using: search)
    }

    func updateLanguages(_ value: Set<ClientCardLanguage>, using search: TCGSearch) {
        if ClientCardLanguage.normalized(value, for: game) == ClientCardLanguage.normalized(languages, for: game) {
            if value != languages { languages = value }
            return
        }
        finishEditing(using: search)
        setNames = []
        languages = value
        scheduleSearch(using: search)
    }

    func availableSetNames(using search: TCGSearch) -> [String] {
        search.results
            .reduce(Set<String>()) { partialResult, card in
                guard let setName = card.setName else { return partialResult }

                var result = partialResult
                result.insert(setName)

                return result
            }
            .union(setNames)
            .sorted()
    }

    func filteredResults(using search: TCGSearch) -> [PricedCard] {
        guard !setNames.isEmpty else { return search.results }
        return search.results.filter { card in
            guard let name = card.setName else { return false }
            return setNames.contains(name)
        }
    }

    func resumeSearchIfNeeded(using search: TCGSearch) {
        guard !search.hasSearched else { return }
        guard !search.isSearching else { return }
        scheduleSearch(using: search)
    }

    func scheduleSearch(using search: TCGSearch) {
        invalidateSearch(using: search)
        let normalizedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard normalizedQuery.count >= 2 else { return }

        let request = SearchRequest(
            game: game, query: normalizedQuery, languages: languages, revision: revision, recordImmediately: false
        )
        searchTask = Task {
            try? await Task.sleep(for: debounce)
            guard !Task.isCancelled else { return }
            await performSearch(request, using: search)
        }
    }

    func performSearch(using search: TCGSearch) async {
        invalidateSearch(using: search)
        let normalizedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard normalizedQuery.count >= 2 else { return }
        let request = SearchRequest(
            game: game, query: normalizedQuery, languages: languages, revision: revision, recordImmediately: true
        )
        await performSearch(request, using: search)
    }

    func selectHistory(_ entry: TCGSearchHistoryEntry, using search: TCGSearch) async {
        finishEditing(using: search)
        if game != entry.game || query.trimmingCharacters(in: .whitespacesAndNewlines) != entry.query {
            setNames = []
        }
        query = entry.query
        if game != entry.game { game = entry.game }
        isSearchFocused = false
        await performSearch(using: search)
    }

    func finishEditing(using search: TCGSearch) {
        if let candidate {
            search.history.record(query: candidate.query, game: candidate.game)
        }
        candidate = nil
        revision = UUID()
        searchTask?.cancel()
        searchTask = nil
        // Invalidate responses still in flight without discarding the displayed cards.
        search.cancel()
    }

    func removeHistory(_ entry: TCGSearchHistoryEntry, using search: TCGSearch) {
        if let candidate {
            if candidate.game == entry.game && candidate.query.caseInsensitiveCompare(entry.query) == .orderedSame {
                self.candidate = nil
            }
        }
        search.history.remove(entry)
    }

    func clearHistory(using search: TCGSearch) {
        candidate = nil
        search.history.clear(game: game)
    }

    private func invalidateSearch(using search: TCGSearch) {
        revision = UUID()
        candidate = nil
        searchTask?.cancel()
        searchTask = nil
        let identity = TCGSearch.SearchIdentity(game: game, query: query, languages: languages)
        if identity.query.count < 2 || identity != search.completedSearch {
            search.clear()
        } else {
            search.cancel()
        }
    }

    func dismissToast() {
        toastTask?.cancel()
        toastTask = nil
        toast = nil
    }

    private struct SearchRequest {
        let game: ClientCardGame
        let query: String
        let languages: Set<ClientCardLanguage>
        let revision: UUID
        let recordImmediately: Bool
    }

    private func performSearch(_ request: SearchRequest, using search: TCGSearch) async {
        let result = await search.searchWithOutcome(
            game: request.game, query: request.query, languages: request.languages
        )
        guard request.revision == revision else { return }
        guard !Task.isCancelled else { return }
        switch result {
        case .failure(let failure): show(failure)
        case .success(let applied):
            guard applied else { return }
            dismissToast()
            guard !search.results.isEmpty else { return }
            candidate = (request.query, request.game)
            if request.recordImmediately {
                search.history.record(query: request.query, game: request.game)
                candidate = nil
            }
        }
    }

    private func show(_ error: TCGSearchOperationError) {
        toastTask?.cancel()
        toast = Toast(title: String(localized: "Search error", bundle: .module), message: error.errorDescription)
        toastTask = Task {
            try? await Task.sleep(for: ModuleConfig.toastDismissalDelay)
            guard !Task.isCancelled else { return }
            toast = nil
        }
    }
}
