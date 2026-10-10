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
    private(set) var cards: [CardWithPrice] = []
    private(set) var availableSetNames: Set<String> = []

    private let client: TCGClient
    private var collectionState = CollectionState()

    var isLoading: Bool { collectionState.status == .loading }
    var hasLoadedCurrentCollection: Bool { collectionState.status == .loaded }

    init(client: TCGClient) {
        self.client = client
    }

    public static func `default`() -> TCGCards { TCGCards(client: .default()) }

    func load(game: ClientCardGame?, setNames: Set<String> = []) async -> Result<Void, TCGCardsOperationError> {
        if game != collectionState.game { availableSetNames = [] }
        collectionState = CollectionState(
            game: game,
            setNames: setNames,
            generation: collectionState.generation + 1,
            status: .loading
        )
        let generation = collectionState.generation
        setCards(cards)
        let result = await client.cards.list(game: game, setNames: setNames)
        guard generation == collectionState.generation else { return .success(()) }
        collectionState.status = .idle
        guard !Task.isCancelled else { return .success(()) }
        return result.map { collection in
            setCards(collection.cards)
            availableSetNames = collection.availableSetNames
            collectionState.status = .loaded
        }.mapError { _ in
            logger.error("Couldn't load the card collection.")
            return .serverUnavailable
        }
    }

    func purchaseDefault(game: ClientCardGame, name: String, cardNumber: String) async -> Result<
        CardSearchResult, SearchPricingErrors
    > {
        await client.pricing.search(game: game, query: "\(name) \(cardNumber)")
    }

    func addCard(_ values: CardFormValues) async -> Result<Void, TCGCardsOperationError> {
        let result = await client.cards.create(with: values.payload)
            .map(insertCard)
            .mapError(mapCreateError)
        if case .success = result { await refresh() }
        return result
    }

    func updateCard(id: String, values: CardFormValues) async -> Result<CardWithPrice, TCGCardsOperationError> {
        let result = await client.cards.update(id: id, with: values.payload)
            .map { card in
                replaceCard(card, id: id)
                return card
            }
            .mapError(mapUpdateError)
        if case .success = result { await refresh() }
        return result
    }

    func deleteCard(id: String) async -> Result<Void, TCGCardsOperationError> {
        await performDeletion(ids: [id]).flatMap { result in
            result.deletedIDs.contains(id) ? .success(()) : .failure(.notFound)
        }
    }

    func deleteCards(ids: [String]) async -> [TCGCardsOperationError] {
        switch await performDeletion(ids: ids) {
        case .success(let result): result.notFoundIDs.map { _ in .notFound }
        case .failure(let error): [error]
        }
    }

    private func performDeletion(ids: [String]) async -> Result<DeleteCardsResult, TCGCardsOperationError> {
        guard !ids.isEmpty else { return .success(DeleteCardsResult(deletedIDs: [], notFoundIDs: [])) }
        switch await client.cards.delete(ids: ids) {
        case .success(let result):
            let deletedIDs = Set(result.deletedIDs)
            if !deletedIDs.isEmpty {
                setCards(cards.filter { !deletedIDs.contains($0.card.id) })
                if collectionState.status == .loaded { collectionState.status = .idle }
                await refresh()
            }
            return .success(result)
        case .failure:
            return .failure(.serverUnavailable)
        }
    }

    private func refresh() async {
        _ = await load(game: collectionState.game, setNames: collectionState.setNames)
    }

    private func setCards(_ cards: [CardWithPrice]) {
        self.cards = cards.filter {
            (collectionState.game == nil || $0.card.game == collectionState.game)
                && (collectionState.setNames.isEmpty || collectionState.setNames.contains($0.card.setName))
        }
    }

    private func insertCard(_ card: CardWithPrice) {
        setCards(cards.prepended(card))
    }

    private func replaceCard(_ card: CardWithPrice, id: String) {
        setCards(cards.map { $0.card.id == id ? card : $0 })
    }

    private struct CollectionState {
        var game: ClientCardGame?
        var setNames: Set<String> = []
        var generation = 0
        var status: Status = .idle

        enum Status {
            case idle
            case loading
            case loaded
        }
    }

    private func mapCreateError(_ error: CreateCardErrors) -> TCGCardsOperationError {
        switch error {
        case .badRequest(let issues): .validation(mapIssues(issues))
        case .unauthorized, .unavailable, .unknown: .serverUnavailable
        }
    }

    private func mapUpdateError(_ error: UpdateCardErrors) -> TCGCardsOperationError {
        switch error {
        case .badRequest(let issues): .validation(mapIssues(issues))
        case .notFound: .notFound
        case .unauthorized, .unavailable, .unknown: .serverUnavailable
        }
    }

    private func mapIssues(_ issues: [TCGClientValidationIssue]) -> [TCGCardsValidationIssue] {
        issues.compactMap { issue in
            guard let path = issue.path.first else { return nil }
            guard let field = TCGCardsValidationField(rawValue: path) else { return nil }
            return .init(field: field, message: issue.message)
        }
    }
}
