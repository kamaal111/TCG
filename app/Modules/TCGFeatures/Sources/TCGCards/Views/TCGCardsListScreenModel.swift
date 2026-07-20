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

    var gameFilter: CardGame?
    var presentedForm: CardFormRoute?

    @ObservationIgnored private var toastTask: Task<Void, Never>?

    func filteredCards(_ cards: [Card]) -> [Card] {
        guard let gameFilter else { return cards }
        return cards.filter { $0.game == gameFilter }
    }

    func load(using cards: TCGCards) async {
        if case .failure(let error) = await cards.loadCards() { show(error) }
    }

    func delete(_ card: Card, using cards: TCGCards) async {
        if case .failure(let error) = await cards.deleteCard(id: card.id) { show(error) }
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

    struct Toast: Equatable, ToastPresentable {
        let title: String
        let message: String
    }
}
