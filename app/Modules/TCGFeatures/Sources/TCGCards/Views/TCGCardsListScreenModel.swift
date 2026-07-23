//
//  TCGCardsListScreenModel.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/20/26.
//

import Observation
import TCGClient
import TCGDesignSystem

@MainActor
@Observable
final class TCGCardsListScreenModel {
    private(set) var toast: Toast?

    var gameFilter: ClientCardGame?
    var presentedForm: CardFormRoute?

    @ObservationIgnored private var toastTask: Task<Void, Never>?

    func load(using cards: TCGCards) async {
        switch await cards.load(game: gameFilter) {
        case .success:
            break
        case .failure(let error):
            show(error)
        }
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
        case edit(Card)

        var id: String {
            switch self {
            case .add: "add"
            case .edit(let card): card.id
            }
        }
    }
}
