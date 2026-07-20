//
//  TCGCards.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/20/26.
//

import Foundation
import KamaalLogger
import Observation
import TCGClient

private let logger = KamaalLogger(from: TCGCards.self)

@MainActor
@Observable
public final class TCGCards {
    private let client: TCGClient

    private(set) var cards: [Card] = []
    private(set) var isLoading = false

    init(client: TCGClient) {
        self.client = client
    }

    public static func `default`() -> TCGCards {
        TCGCards(client: TCGClient.default())
    }

    func loadCards() async -> Result<Void, TCGCardsOperationError> {
        isLoading = true
        defer { isLoading = false }

        let result = await client.cards.list()
        switch result {
        case .failure(.unauthorized), .failure(.unknown):
            logger.error("Couldn't load the card collection from the server.")
            return .failure(.serverUnavailable)
        case .success(let loadedCards):
            cards = loadedCards
            logger.info("Loaded the card collection.")
            return .success(())
        }
    }

    func addCard(_ values: CardFormValues) async -> Result<Void, TCGCardsOperationError> {
        let result = await client.cards.create(with: values.asPayload)
        switch result {
        case .failure(.badRequest(let validations)):
            return .failure(.validation(mapValidationIssues(validations)))
        case .failure(.unauthorized), .failure(.unknown):
            logger.error("Card creation failed while communicating with the server.")
            return .failure(.serverUnavailable)
        case .success(let createdCard):
            cards.insert(createdCard, at: 0)
            logger.info("Added a card to the collection.")
            return .success(())
        }
    }

    func updateCard(id: String, values: CardFormValues) async -> Result<Void, TCGCardsOperationError> {
        let result = await client.cards.update(id: id, with: values.asPayload)
        switch result {
        case .failure(.badRequest(let validations)):
            return .failure(.validation(mapValidationIssues(validations)))
        case .failure(.notFound):
            logger.warning("The card to update could not be found.")
            return .failure(.notFound)
        case .failure(.unauthorized), .failure(.unknown):
            logger.error("Card update failed while communicating with the server.")
            return .failure(.serverUnavailable)
        case .success(let updatedCard):
            if let index = cards.firstIndex(where: { card in card.id == id }) {
                cards[index] = updatedCard
            }
            logger.info("Updated a card in the collection.")
            return .success(())
        }
    }

    func deleteCard(id: String) async -> Result<Void, TCGCardsOperationError> {
        let result = await client.cards.delete(id: id)
        switch result {
        case .failure(.notFound):
            logger.warning("The card to delete could not be found.")
            return .failure(.notFound)
        case .failure(.unauthorized), .failure(.unknown):
            logger.error("Card deletion failed while communicating with the server.")
            return .failure(.serverUnavailable)
        case .success:
            cards.removeAll(where: { card in card.id == id })
            logger.info("Deleted a card from the collection.")
            return .success(())
        }
    }

    private func mapValidationIssues(_ issues: [TCGClientValidationIssue]) -> [TCGCardsValidationIssue] {
        issues.compactMap { issue in
            let field = issue.path
                .compactMap { pathComponent in TCGCardsValidationField(rawValue: pathComponent) }
                .first
            guard let field else { return nil }

            return TCGCardsValidationIssue(field: field, message: issue.message)
        }
    }
}
