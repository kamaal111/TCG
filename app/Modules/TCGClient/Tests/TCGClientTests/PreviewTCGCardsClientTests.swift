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
    func `Success seeds the configured cards`() async throws {
        let client = TCGClient.preview(cardsOutcome: .success(cards: PreviewTCGCardsClient.sampleCards))
        #expect(try await client.cards.list().get() == PreviewTCGCardsClient.sampleCards)
    }

    @Test
    func `Empty starts with no cards`() async throws {
        #expect(try await TCGClient.preview(cardsOutcome: .empty).cards.list().get() == [])
    }

    @Test
    func `Create appends a card`() async throws {
        let client = TCGClient.preview(cardsOutcome: .empty)
        let created = try await client.cards.create(with: previewPayload).get()
        #expect(try await client.cards.list().get() == [created])
    }

    @Test
    func `Update replaces a card`() async throws {
        let client = TCGClient.preview(cardsOutcome: .success(cards: PreviewTCGCardsClient.sampleCards))
        let updated = try await client.cards.update(id: "preview-card-1", with: previewPayload).get()
        #expect(updated.name == previewPayload.name)
        #expect(try await client.cards.list().get().first == updated)
    }

    @Test
    func `Update rejects an unknown identifier`() async {
        let client = TCGClient.preview(cardsOutcome: .empty)
        await #expect(throws: UpdateCardErrors.notFound) {
            try await client.cards.update(id: "missing", with: previewPayload).get()
        }
    }

    @Test
    func `Delete removes a card`() async throws {
        let client = TCGClient.preview(cardsOutcome: .success(cards: PreviewTCGCardsClient.sampleCards))
        _ = try await client.cards.delete(id: "preview-card-1").get()
        #expect(try await client.cards.list().get().map(\.id) == ["preview-card-2"])
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
    func `Not found outcome rejects update and delete`() async {
        let client = TCGClient.preview(cardsOutcome: .notFound)
        await #expect(throws: UpdateCardErrors.notFound) {
            try await client.cards.update(id: "preview-card-1", with: previewPayload).get()
        }
        await #expect(throws: DeleteCardErrors.notFound) {
            try await client.cards.delete(id: "preview-card-1").get()
        }
    }

    @Test
    func `Server unavailable outcome rejects every operation`() async {
        let client = TCGClient.preview(cardsOutcome: .serverUnavailable)
        await #expect(throws: ListCardsErrors.unknown(status: 503, payload: nil, cause: nil)) {
            try await client.cards.list().get()
        }
        await #expect(throws: CreateCardErrors.unknown(status: 503, payload: nil, cause: nil)) {
            try await client.cards.create(with: previewPayload).get()
        }
        await #expect(throws: UpdateCardErrors.unknown(status: 503, payload: nil, cause: nil)) {
            try await client.cards.update(id: "preview-card-1", with: previewPayload).get()
        }
        await #expect(throws: DeleteCardErrors.unknown(status: 503, payload: nil, cause: nil)) {
            try await client.cards.delete(id: "preview-card-1").get()
        }
    }
}

private let previewPayload = UpsertCardPayload(
    game: .pokemon,
    name: "Bulbasaur",
    setName: "Base Set",
    cardNumber: "44/102",
    notes: nil,
    quantities: [.init(condition: .excellent, quantity: 1)]
)
