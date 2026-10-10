//
//  TCGCardsListScreenModel.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/20/26.
//

import Foundation
import Observation
import TCGClient
import TCGDesignSystem

@MainActor
@Observable
final class TCGCardsListScreenModel {
    private(set) var toast: Toast?

    var gameFilter: ClientCardGame? {
        didSet {
            guard !isRestoringFilters else { return }
            guard gameFilter != oldValue else { return }
            setNames = []
            preferences?.set(gameFilter?.rawValue, forKey: PreferenceKey.game)
        }
    }
    var setNames: Set<String> = [] {
        didSet {
            guard !isRestoringFilters else { return }
            preferences?.set(setNames.sorted(), forKey: PreferenceKey.setNames)
        }
    }
    var presentedForm: CardFormRoute?
    var presentedImageURL: URL?

    @ObservationIgnored private let preferences: UserDefaults?
    @ObservationIgnored private var isRestoringFilters = true

    @ObservationIgnored private var toastTask: Task<Void, Never>?
    @ObservationIgnored private var loadedFilters: FilterSelection?

    var filters: FilterSelection { FilterSelection(game: gameFilter, setNames: setNames) }

    init(preferences: UserDefaults? = .standard) {
        self.preferences = preferences
        let saved = Self.loadFilters(from: preferences)
        gameFilter = saved.game
        setNames = saved.setNames
        isRestoringFilters = false
    }

    private static func loadFilters(from preferences: UserDefaults?) -> FilterSelection {
        var game: ClientCardGame?
        if let storedGame = preferences?.object(forKey: PreferenceKey.game) {
            guard let rawValue = storedGame as? String else { return FilterSelection(game: nil, setNames: []) }
            guard let parsed = ClientCardGame(rawValue: rawValue) else {
                return FilterSelection(game: nil, setNames: [])
            }
            game = parsed
        }
        let setNames = preferences?.object(forKey: PreferenceKey.setNames) as? [String] ?? []
        return FilterSelection(game: game, setNames: Set(setNames))
    }

    private enum PreferenceKey {
        static let game = "TCGCards.filters.game"
        static let setNames = "TCGCards.filters.setNames"
    }

    func resumeLoadIfNeeded(using cards: TCGCards) async {
        guard loadedFilters != filters || !cards.hasLoadedCurrentCollection else { return }
        await load(using: cards)
    }

    func showDetails(of card: CardWithPrice) {
        presentedForm = .detail(card)
    }

    func exploreImage(of card: CardWithPrice) {
        presentedImageURL = card.price.price?.imageURL
    }

    func load(using cards: TCGCards) async {
        let requested = filters
        switch await cards.load(game: requested.game, setNames: requested.setNames) {
        case .success:
            if requested == filters && !Task.isCancelled { loadedFilters = requested }
        case .failure(let error):
            show(error)
        }
    }

    func availableSetNames(using cards: TCGCards) -> [String] {
        cards.availableSetNames.union(setNames).sorted()
    }

    func delete(at offsets: IndexSet, using cards: TCGCards) async {
        let selectedCards = offsets.map { cards.cards[$0].card }
        let errors = await cards.deleteCards(ids: selectedCards.map(\.id))
        for error in errors { show(error) }
    }

    func delete(_ card: Card, using cards: TCGCards) async {
        switch await cards.deleteCard(id: card.id) {
        case .success:
            break
        case .failure(let error):
            show(error)
        }
    }

    func dismissToast() {
        toastTask?.cancel()
        toastTask = nil
        toast = nil
    }

    private func show(_ error: TCGCardsOperationError) {
        toastTask?.cancel()
        toast = Toast(title: String(localized: "Collection error"), message: error.errorDescription ?? "")
        toastTask = Task {
            try? await Task.sleep(for: ModuleConfig.toastDismissalDelay)
            guard !Task.isCancelled else { return }
            toast = nil
        }
    }

    enum CardFormRoute: Identifiable {
        case add
        case detail(CardWithPrice)

        var id: String {
            switch self {
            case .add: "add"
            case .detail(let card): card.card.id
            }
        }
    }

    struct FilterSelection: Hashable {
        let game: ClientCardGame?
        let setNames: Set<String>
    }
}
