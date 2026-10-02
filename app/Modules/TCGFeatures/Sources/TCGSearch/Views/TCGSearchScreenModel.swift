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
    var game: ClientCardGame = .pokemon {
        didSet { languages = loadLanguages(for: game) }
    }
    var languages: Set<ClientCardLanguage> = [] {
        didSet {
            preferences?.set(languages.map(\.rawValue).sorted(), forKey: Self.preferenceKey(for: game))
        }
    }

    @ObservationIgnored private let preferences: UserDefaults?

    init(preferences: UserDefaults? = .standard) {
        self.preferences = preferences
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

    func scheduleSearch(using search: TCGSearch) {
        searchTask?.cancel()
        let normalizedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard normalizedQuery.count >= 2 else {
            search.clear()
            return
        }

        let request = SearchRequest(game: game, query: normalizedQuery, languages: languages)
        searchTask = Task {
            try? await Task.sleep(for: ModuleConfig.searchDebounce)
            guard !Task.isCancelled else { return }
            await performSearch(request, using: search)
        }
    }

    func performSearch(using search: TCGSearch) async {
        searchTask?.cancel()
        searchTask = nil
        let normalizedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard normalizedQuery.count >= 2 else {
            search.clear()
            return
        }
        await performSearch(SearchRequest(game: game, query: normalizedQuery, languages: languages), using: search)
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
    }

    private func performSearch(_ request: SearchRequest, using search: TCGSearch) async {
        switch await search.search(game: request.game, query: request.query, languages: request.languages) {
        case .failure(let failure): show(failure)
        case .success: dismissToast()
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
