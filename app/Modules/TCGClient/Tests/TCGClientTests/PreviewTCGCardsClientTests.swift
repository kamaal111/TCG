//
//  PreviewTCGCardsClientTests.swift
//  TCGClient
//
//  Created by Kamaal M Farah on 7/20/26.
//

import Testing

@testable import TCGClient

@Suite("Preview TCGCards Client Tests")
struct PreviewTCGCardsClientTests {
    @Test
    func `Set choices remain complete when filtering multiple sets across games`() async throws {
        let client = TCGClient.preview(cardsOutcome: .success(cards: PreviewTCGCardsClient.sampleCards))
        let selected = try await client.cards.list(game: nil, setNames: ["Base Set", "Romance Dawn"]).get()
        let pokemon = try await client.cards.list(game: .pokemon, setNames: ["Romance Dawn"]).get()

        #expect(selected.cards.map(\.card) == PreviewTCGCardsClient.sampleCards)
        #expect(selected.availableSetNames == ["Base Set", "Romance Dawn"])
        #expect(pokemon.cards.isEmpty)
        #expect(pokemon.availableSetNames == ["Base Set"])
    }

    @Test
    func `Set selections match exactly and preserve supplied prices`() async throws {
        let cards = PreviewTCGCardsClient.sampleCards.map {
            CardWithPrice(card: $0, price: OwnedCardPrice(cardId: $0.id, status: .unavailable))
        }
        let client = TCGClient.preview(cardsOutcome: .successWithPrices(cards))
        let selected = try await client.cards.list(game: nil, setNames: ["Base Set"]).get()
        let differentlyCased = try await client.cards.list(game: nil, setNames: ["base set"]).get()

        #expect(selected.cards == [cards[1]])
        #expect(differentlyCased.cards.isEmpty)
    }

    @Test
    func `Preserves explicit unavailable pricing and filters by game`() async throws {
        let cards = PreviewTCGCardsClient.sampleCards.map {
            CardWithPrice(card: $0, price: OwnedCardPrice(cardId: $0.id, status: .unavailable))
        }
        let client = TCGClient.preview(cardsOutcome: .successWithPrices(cards))
        #expect(try await client.cards.list(game: nil).get() == cards)
        #expect(try await client.cards.list(game: .pokemon).get() == cards.filter { $0.card.game == .pokemon })
    }

    @Test
    func `Success seeds the configured cards`() async throws {
        let client = TCGClient.preview(cardsOutcome: .success(cards: PreviewTCGCardsClient.sampleCards))
        #expect(try await client.cards.list(game: nil).get().map(\.card) == PreviewTCGCardsClient.sampleCards)
    }

    @Test
    func `Lists only cards from the requested game`() async throws {
        let client = TCGClient.preview(cardsOutcome: .success(cards: PreviewTCGCardsClient.sampleCards))

        #expect(try await client.cards.list(game: .pokemon).get().map(\.card.id) == ["preview-card-2"])
    }

    @Test
    func `Empty starts with no cards`() async throws {
        #expect(try await TCGClient.preview(cardsOutcome: .empty).cards.list(game: nil).get() == [])
    }

    @Test
    func `Create appends a card`() async throws {
        let client = TCGClient.preview(cardsOutcome: .empty)
        let created = try await client.cards.create(with: previewPayload).get()
        #expect(try await client.cards.list(game: nil).get().map(\.card) == [created.card])
    }

    @Test
    func `Update replaces a card`() async throws {
        let client = TCGClient.preview(cardsOutcome: .success(cards: PreviewTCGCardsClient.sampleCards))
        let updated = try await client.cards.update(id: "preview-card-1", with: previewPayload).get()
        #expect(updated.card.name == previewPayload.name)
        #expect(try await client.cards.list(game: nil).get().first?.card == updated.card)
    }

    @Test
    func `Update rejects an unknown identifier`() async {
        let client = TCGClient.preview(cardsOutcome: .empty)
        await #expect(throws: UpdateCardErrors.notFound) {
            try await client.cards.update(id: "missing", with: previewPayload).get()
        }
    }

    @Test
    func `Deletion deduplicates, preserves unselected cards, and supports retries`() async throws {
        let client = TCGClient.preview(cardsOutcome: .success(cards: PreviewTCGCardsClient.sampleCards))
        let ids = ["preview-card-1", "missing", "preview-card-1"]
        #expect(
            try await client.cards.delete(ids: ids).get()
                == DeleteCardsResult(deletedIDs: ["preview-card-1"], notFoundIDs: ["missing"])
        )
        #expect(try await client.cards.list(game: nil).get().map(\.card.id) == ["preview-card-2"])
        #expect(
            try await client.cards.delete(ids: ids).get()
                == DeleteCardsResult(deletedIDs: [], notFoundIDs: ["preview-card-1", "missing"])
        )
        #expect(try await client.cards.delete(ids: []).get() == DeleteCardsResult(deletedIDs: [], notFoundIDs: []))
    }

    @Test
    func `Deletion honors configured not found outcomes`() async throws {
        let client = TCGClient.preview(cardsOutcome: .notFound)
        #expect(
            try await client.cards.delete(ids: ["preview-card-1"]).get()
                == DeleteCardsResult(deletedIDs: [], notFoundIDs: ["preview-card-1"])
        )
        #expect(try await client.cards.list(game: nil).get().count == 2)
    }

    @Test
    func `Deletion honors configured validation failures`() async {
        let issue = TCGClientValidationIssue(code: "invalid_format", path: ["card_ids", "0"], message: "Invalid UUID")
        let client = TCGClient.preview(cardsOutcome: .validationErrors([issue]))
        await #expect(throws: DeleteCardsErrors.badRequest(validations: [issue])) {
            try await client.cards.delete(ids: ["invalid"]).get()
        }
    }

    @Test
    func `Validation outcome rejects create`() async {
        let issue = TCGClientValidationIssue(code: "too_small", path: ["name"], message: "Required")
        let client = TCGClient.preview(cardsOutcome: .validationErrors([issue]))
        await #expect(throws: CreateCardErrors.badRequest(validations: [issue])) {
            try await client.cards.create(with: previewPayload).get()
        }
    }

    @Test
    func `Not found outcome rejects update`() async {
        let client = TCGClient.preview(cardsOutcome: .notFound)
        await #expect(throws: UpdateCardErrors.notFound) {
            try await client.cards.update(id: "preview-card-1", with: previewPayload).get()
        }
    }

    @Test
    func `Server unavailable outcome rejects every operation`() async {
        let client = TCGClient.preview(cardsOutcome: .serverUnavailable)
        await #expect(throws: ListCardsErrors.unavailable) {
            try await client.cards.list(game: nil).get()
        }
        await #expect(throws: CreateCardErrors.unavailable) {
            try await client.cards.create(with: previewPayload).get()
        }
        await #expect(throws: UpdateCardErrors.unavailable) {
            try await client.cards.update(id: "preview-card-1", with: previewPayload).get()
        }
        await #expect(throws: DeleteCardsErrors.unknown(status: 503, payload: nil, cause: nil)) {
            try await client.cards.delete(ids: ["preview-card-1"]).get()
        }
    }
}

private let previewPayload = UpsertCardPayload(
    game: .pokemon,
    name: "Bulbasaur",
    setName: "Base Set",
    cardNumber: "44/102",
    notes: nil,
    purchases: [.init(condition: .excellent, quantity: 1)]
)
