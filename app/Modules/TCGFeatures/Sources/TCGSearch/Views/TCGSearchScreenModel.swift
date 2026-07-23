//
//  TCGSearchScreenModel.swift
//  TCGFeatures
//

import Observation
import TCGClient
import TCGDesignSystem

@MainActor
@Observable
final class TCGSearchScreenModel {
    var query = ""
    var game: ClientCardGame = .pokemon

    private(set) var toast: Toast?

    @ObservationIgnored private var searchTask: Task<Void, Never>?
    @ObservationIgnored private var toastTask: Task<Void, Never>?

    func scheduleSearch(using search: TCGSearch) {
        searchTask?.cancel()
        let normalizedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard normalizedQuery.count >= 2 else {
            search.clear()
            return
        }

        let game = game
        searchTask = Task {
            try? await Task.sleep(for: ModuleConfig.searchDebounce)
            guard !Task.isCancelled else { return }
            await performSearch(game: game, query: normalizedQuery, using: search)
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
        await performSearch(game: game, query: normalizedQuery, using: search)
    }

    func dismissToast() {
        toastTask?.cancel()
        toastTask = nil
        toast = nil
    }

    private func performSearch(game: ClientCardGame, query: String, using search: TCGSearch) async {
        switch await search.search(game: game, query: query) {
        case .failure(let failure): show(failure)
        case .success: dismissToast()
        }
    }

    private func show(_ error: TCGSearchOperationError) {
        toastTask?.cancel()
        toast = Toast(title: String(localized: "Search error"), message: error.errorDescription)
        toastTask = Task {
            try? await Task.sleep(for: ModuleConfig.toastDismissalDelay)
            guard !Task.isCancelled else { return }
            toast = nil
        }
    }
}
