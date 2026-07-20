//
//  PreviewTCGCardsClient.swift
//  TCGClient
//
//  Created by Kamaal M Farah on 7/20/26.
//

import Foundation
import os

/// A ``TCGCardsClient`` for SwiftUI previews that returns fixed, deterministic responses without any network I/O.
struct PreviewTCGCardsClient: TCGCardsClient {
    private let outcome: PreviewTCGCardsOutcome
    private let state: OSAllocatedUnfairLock<[Card]>

    init(outcome: PreviewTCGCardsOutcome) {
        self.outcome = outcome
        let seededCards: [Card] =
            switch outcome {
            case .success(let cards): cards
            case .empty, .serverUnavailable: []
            case .validationErrors, .notFound: Self.sampleCards
            }
        self.state = OSAllocatedUnfairLock(initialState: seededCards)
    }

    func list() async -> Result<[Card], ListCardsErrors> {
        switch outcome {
        case .serverUnavailable:
            return .failure(.unknown(status: 500, payload: nil, cause: nil))
        case .success, .empty, .validationErrors, .notFound:
            return .success(state.withLock { cards in cards })
        }
    }

    func create(with payload: UpsertCardPayload) async -> Result<Card, CreateCardErrors> {
        switch outcome {
        case .serverUnavailable:
            return .failure(.unknown(status: 500, payload: nil, cause: nil))
        case .validationErrors(let issues):
            return .failure(.badRequest(validations: issues))
        case .success, .empty, .notFound:
            let createdCard = state.withLock { cards in
                let createdCard = Self.makeCard(from: payload, id: "preview-card-\(cards.count + 1)")
                cards.append(createdCard)
                return createdCard
            }
            return .success(createdCard)
        }
    }

    func update(id: String, with payload: UpsertCardPayload) async -> Result<Card, UpdateCardErrors> {
        switch outcome {
        case .serverUnavailable:
            return .failure(.unknown(status: 500, payload: nil, cause: nil))
        case .validationErrors(let issues):
            return .failure(.badRequest(validations: issues))
        case .notFound:
            return .failure(.notFound)
        case .success, .empty:
            let updatedCard = state.withLock { cards -> Card? in
                guard let index = cards.firstIndex(where: { card in card.id == id }) else { return nil }

                let updatedCard = Self.makeCard(from: payload, id: id, createdAt: cards[index].createdAt)
                cards[index] = updatedCard
                return updatedCard
            }
            guard let updatedCard else { return .failure(.notFound) }

            return .success(updatedCard)
        }
    }

    func delete(id: String) async -> Result<Void, DeleteCardErrors> {
        switch outcome {
        case .serverUnavailable:
            return .failure(.unknown(status: 500, payload: nil, cause: nil))
        case .notFound:
            return .failure(.notFound)
        case .success, .empty, .validationErrors:
            let removed = state.withLock { cards -> Bool in
                guard let index = cards.firstIndex(where: { card in card.id == id }) else { return false }

                cards.remove(at: index)
                return true
            }
            guard removed else { return .failure(.notFound) }

            return .success(())
        }
    }

    static let sampleCards: [Card] = [
        Card(
            id: "preview-card-1",
            game: .onePiece,
            name: "Monkey D. Luffy",
            setName: "Romance Dawn",
            cardNumber: "OP01-003",
            notes: nil,
            quantities: [
                CardConditionQuantity(condition: .nearMint, quantity: 2),
                CardConditionQuantity(condition: .played, quantity: 1),
            ],
            createdAt: referenceDate,
            updatedAt: referenceDate
        ),
        Card(
            id: "preview-card-2",
            game: .pokemon,
            name: "Pikachu",
            setName: "Base Set",
            cardNumber: "58/102",
            notes: "First edition",
            quantities: [CardConditionQuantity(condition: .mint, quantity: 1)],
            createdAt: referenceDate,
            updatedAt: referenceDate
        ),
    ]

    private static let referenceDate = Date(timeIntervalSince1970: 1_750_000_000)

    private static func makeCard(from payload: UpsertCardPayload, id: String, createdAt: Date? = nil) -> Card {
        Card(
            id: id,
            game: payload.game,
            name: payload.name,
            setName: payload.setName,
            cardNumber: payload.cardNumber,
            notes: payload.notes,
            quantities: payload.quantities,
            createdAt: createdAt ?? referenceDate,
            updatedAt: referenceDate
        )
    }
}
