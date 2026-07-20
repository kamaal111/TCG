//
//  TCGCardsListScreenModel.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/20/26.
//

import Foundation
import Observation
import TCGClient

@MainActor
@Observable
final class TCGCardsListScreenModel {
    var gameFilter: CardGame?
    var presentedForm: CardFormRoute?

    private(set) var toast: Toast?

    @ObservationIgnored
    private var toastDismissalTask: Task<Void, Never>?

    func filteredCards(_ cards: [Card]) -> [Card] {
        guard let gameFilter else { return cards }

        return cards.filter { card in card.game == gameFilter }
    }

    func load(using cards: TCGCards) async {
        switch await cards.loadCards() {
        case .failure(let error):
            showErrorToast(message: error.errorDescription)
        case .success:
            dismissToast()
        }
    }

    func delete(_ card: Card, using cards: TCGCards) async {
        switch await cards.deleteCard(id: card.id) {
        case .failure(let error):
            showErrorToast(message: error.errorDescription)
        case .success:
            break
        }
    }

    func dismissToast() {
        toastDismissalTask?.cancel()
        toastDismissalTask = nil
        toast = nil
    }

    private func showErrorToast(message: String) {
        toastDismissalTask?.cancel()
        toast = Toast(title: String(localized: "Collection error"), message: message)
        toastDismissalTask = Task {
            try? await Task.sleep(for: ModuleConfig.toastDismissalDelay)
            guard !Task.isCancelled else { return }
            toast = nil
        }
    }

    enum CardFormRoute: Identifiable {
        case add
        case edit(Card)

        var id: String {
            switch self {
            case .add: "add"
            case .edit(let card): card.id
            }
        }
    }

    struct Toast: Equatable {
        let title: String
        let message: String
    }
}
