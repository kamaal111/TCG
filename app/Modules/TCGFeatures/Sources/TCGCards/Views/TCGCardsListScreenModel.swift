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
            illustrators = []
            preferences?.set(gameFilter?.rawValue, forKey: PreferenceKey.game)
        }
    }
    var setNames: Set<String> = [] {
        didSet {
            guard !isRestoringFilters else { return }
            preferences?.set(setNames.sorted(), forKey: PreferenceKey.setNames)
        }
    }
    var illustrators: Set<String> = [] {
        didSet {
            guard !isRestoringFilters else { return }
            preferences?.set(illustrators.sorted(), forKey: PreferenceKey.illustrators)
        }
    }
    var query = ""
    var presentedForm: CardFormRoute?
    var presentedImageURL: URL?
    var cardToDelete: Card?
    private(set) var isMutatingCard = false

    @ObservationIgnored private let preferences: UserDefaults?
    @ObservationIgnored private var isRestoringFilters = true

    @ObservationIgnored private var toastTask: Task<Void, Never>?
    @ObservationIgnored private var loadedFilters: FilterSelection?

    var filters: FilterSelection {
        FilterSelection(game: gameFilter, setNames: setNames, query: query, illustrators: illustrators)
    }

    init(preferences: UserDefaults? = .standard) {
        self.preferences = preferences
        let saved = Self.loadFilters(from: preferences)
        gameFilter = saved.game
        setNames = saved.setNames
        illustrators = saved.illustrators
        isRestoringFilters = false
    }

    private static func loadFilters(from preferences: UserDefaults?) -> FilterSelection {
        var game: ClientCardGame?
        if let storedGame = preferences?.object(forKey: PreferenceKey.game) {
            guard let rawValue = storedGame as? String else {
                return FilterSelection(game: nil, setNames: [], query: "", illustrators: [])
            }
            guard let parsed = ClientCardGame(rawValue: rawValue) else {
                return FilterSelection(game: nil, setNames: [], query: "", illustrators: [])
            }
            game = parsed
        }
        let setNames = preferences?.object(forKey: PreferenceKey.setNames) as? [String] ?? []
        return FilterSelection(
            game: game,
            setNames: Set(setNames),
            query: "",
            illustrators: game == .onePiece
                ? [] : Set(preferences?.stringArray(forKey: PreferenceKey.illustrators) ?? [])
        )
    }

    private enum PreferenceKey {
        static let game = "TCGCards.filters.game"
        static let illustrators = "TCGCards.filters.illustrators"
        static let setNames = "TCGCards.filters.setNames"
    }

    func resumeLoadIfNeeded(using cards: TCGCards) async {
        guard loadedFilters != filters || !cards.hasLoadedCurrentCollection else { return }
        if filters.searchQuery != nil {
            try? await Task.sleep(for: ModuleConfig.searchDebounce)
            guard !Task.isCancelled else { return }
        }
        await load(using: cards)
    }

    func showDetails(of card: CardWithPrice) {
        presentedForm = .detail(card)
    }

    func showEdit(for card: CardWithPrice) {
        presentedForm = .edit(card)
    }

    func destinations(for card: Card, in collections: [CardCollectionSummary]) -> [CardCollectionSummary] {
        collections.filter { !$0.isUnfiled && $0.id != card.collectionID }
    }

    func move(_ card: Card, to destination: CardCollectionSummary, using cards: TCGCards) async {
        guard !cards.isReadOnly else { return }
        guard !isMutatingCard else { return }
        guard !destination.isUnfiled, destination.id != card.collectionID else { return }

        isMutatingCard = true
        defer { isMutatingCard = false }
        if case .failure(let error) = await cards.moveCard(card, to: destination.id) {
            show(error)
        }
    }

    func exploreImage(of card: CardWithPrice) {
        presentedImageURL = card.price.price?.imageURL
    }

    func load(using cards: TCGCards) async {
        let requested = filters
        switch await cards.load(
            game: requested.game,
            setNames: requested.setNames,
            query: requested.searchQuery,
            illustrators: requested.illustrators
        ) {
        case .success:
            if requested == filters && !Task.isCancelled { loadedFilters = requested }
        case .failure(let error):
            show(error)
        }
    }

    func availableSetNames(using cards: TCGCards) -> [String] {
        cards.availableSetNames.union(setNames).sorted()
    }

    func availableIllustrators(using cards: TCGCards) -> [String] {
        cards.availableIllustrators.union(illustrators).sorted()
    }

    func delete(at offsets: IndexSet, using cards: TCGCards) async {
        guard !cards.isReadOnly, !isMutatingCard else { return }
        isMutatingCard = true
        defer { isMutatingCard = false }
        let selectedCards = offsets.map { cards.cards[$0].card }
        let errors = await cards.deleteCards(ids: selectedCards.map(\.id))
        for error in errors { show(error) }
    }

    func delete(_ card: Card, using cards: TCGCards) async {
        guard !cards.isReadOnly, !isMutatingCard else { return }
        isMutatingCard = true
        defer { isMutatingCard = false }
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

    func show(_ error: TCGCardsOperationError) {
        let message: String
        if case .validation(let issues) = error, let issue = issues.first(where: { $0.field == .collection }) {
            message = issue.message
        } else {
            message = error.errorDescription ?? ""
        }
        toastTask?.cancel()
        toast = Toast(title: String(localized: "Collection error", bundle: .module), message: message)
        toastTask = Task {
            try? await Task.sleep(for: ModuleConfig.toastDismissalDelay)
            guard !Task.isCancelled else { return }
            toast = nil
        }
    }

    enum CardFormRoute: Identifiable {
        case add
        case detail(CardWithPrice)
        case edit(CardWithPrice)

        enum ID: Hashable {
            case add
            case detail(UUID)
            case edit(UUID)
        }

        var id: ID {
            switch self {
            case .add: .add
            case .detail(let card): .detail(card.card.id)
            case .edit(let card): .edit(card.card.id)
            }
        }
    }

    struct FilterSelection: Hashable {
        let game: ClientCardGame?
        let setNames: Set<String>
        let query: String
        let illustrators: Set<String>

        var searchQuery: String? {
            let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : trimmed
        }
    }
}
