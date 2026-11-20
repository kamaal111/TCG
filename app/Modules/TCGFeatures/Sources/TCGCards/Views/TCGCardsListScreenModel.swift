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
import TCGModels

@MainActor
@Observable
final class TCGCardsListScreenModel {
    private(set) var toast: Toast?

    let filterState: CardListFilterState

    var presentedForm: CardFormRoute?
    var presentedImageURL: URL?
    var cardToDelete: Card?
    private(set) var isMutatingCard = false

    @ObservationIgnored private var toastTask: Task<Void, Never>?
    @ObservationIgnored private var loadedFilters: CardListFilters?

    var filters: CardListFilters { filterState.filters }

    init(preferences: UserDefaults?) {
        filterState = CardListFilterState(preferences: preferences, preferenceScope: .allCards)
    }

    func resumeLoadIfNeeded(using cards: TCGCards) async {
        if loadedFilters == filters, cards.hasLoadedCurrentCollection {
            await cards.refresh(force: false)
            return
        }
        if filters.query != nil {
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
        presentedImageURL = card.imageURL
    }

    func load(using cards: TCGCards) async {
        let requested = filters
        switch await cards.load(
            game: requested.game,
            setNames: requested.setNames,
            query: requested.query,
            illustrators: requested.illustrators
        ) {
        case .success:
            if requested == filters && !Task.isCancelled { loadedFilters = requested }
        case .failure(let error):
            show(error)
        }
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
        case detail(CardWithPrice)
        case edit(CardWithPrice)

        enum ID: Hashable {
            case detail(UUID)
            case edit(UUID)
        }

        var id: ID {
            switch self {
            case .detail(let card): .detail(card.card.id)
            case .edit(let card): .edit(card.card.id)
            }
        }
    }
}
