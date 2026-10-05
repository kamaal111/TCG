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
            if gameFilter != oldValue { setNames = [] }
        }
    }
    var setNames: Set<String> = []
    var presentedForm: CardFormRoute?
    var presentedImageURL: URL?

    @ObservationIgnored private var toastTask: Task<Void, Never>?
    @ObservationIgnored private var loadedFilters: FilterSelection?

    var filters: FilterSelection { FilterSelection(game: gameFilter, setNames: setNames) }

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
