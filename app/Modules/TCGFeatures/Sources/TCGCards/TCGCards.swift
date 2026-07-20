//
//  TCGCards.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/20/26.
//

import KamaalExtensions
import KamaalLogger
import Observation
import TCGClient

private let logger = KamaalLogger(from: TCGCards.self)

@MainActor
@Observable
public final class TCGCards {
    private(set) var cards: [Card] = []
    private(set) var isLoading = false
    private let client: TCGClient

    init(client: TCGClient) {
        self.client = client
    }

    public static func `default`() -> TCGCards { TCGCards(client: .default()) }

    func loadCards() async -> Result<Void, TCGCardsOperationError> {
        isLoading = true
        defer { isLoading = false }
        return await client.cards.list()
            .map { setCards($0) }
            .mapError { _ in
                logger.error("Couldn't load the card collection.")
                return .serverUnavailable
            }
    }

    func addCard(_ values: CardFormValues) async -> Result<Void, TCGCardsOperationError> {
        await client.cards.create(with: values.payload)
            .map { insertCard($0) }
            .mapError(mapCreateError)
    }

    func updateCard(id: String, values: CardFormValues) async -> Result<Void, TCGCardsOperationError> {
        await client.cards.update(id: id, with: values.payload)
            .map { replaceCard($0, id: id) }
            .mapError(mapUpdateError)
    }

    func deleteCard(id: String) async -> Result<Void, TCGCardsOperationError> {
        await client.cards.delete(id: id)
            .map { removeCard(id: id) }
            .mapError {
                switch $0 {
                case .notFound: .notFound
                case .unauthorized, .unknown: .serverUnavailable
                }
            }
    }

    private func setCards(_ cards: [Card]) {
        self.cards = cards
    }

    private func insertCard(_ card: Card) {
        setCards(cards.prepended(card))
    }

    private func replaceCard(_ card: Card, id: String) {
        setCards(cards.map { $0.id == id ? card : $0 })
    }

    private func removeCard(id: String) {
        guard let index = cards.findIndex(by: \.id, is: id) else {
            assertionFailure("Expected to find by id")
            return
        }

        setCards(cards.removed(at: index))
    }

    private func mapCreateError(_ error: CreateCardErrors) -> TCGCardsOperationError {
        switch error {
        case .badRequest(let issues): .validation(mapIssues(issues))
        case .unauthorized, .unknown: .serverUnavailable
        }
    }

    private func mapUpdateError(_ error: UpdateCardErrors) -> TCGCardsOperationError {
        switch error {
        case .badRequest(let issues): .validation(mapIssues(issues))
        case .notFound: .notFound
        case .unauthorized, .unknown: .serverUnavailable
        }
    }

    private func mapIssues(_ issues: [TCGClientValidationIssue]) -> [TCGCardsValidationIssue] {
        issues.compactMap { issue in
            guard let path = issue.path.last else { return nil }
            guard let field = TCGCardsValidationField(rawValue: path) else { return nil }
            return .init(field: field, message: issue.message)
        }
    }
}
