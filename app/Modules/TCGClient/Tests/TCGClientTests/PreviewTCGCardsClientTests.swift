//
//  PreviewTCGCardsClientTests.swift
//  TCGClient
//
//  Created by Kamaal M Farah on 7/20/26.
//

import Foundation
import Testing

@testable import TCGClient

@Suite("Preview TCGCardsClient Tests")
struct PreviewTCGCardsClientTests {
    @Test
    func `Should list the seeded sample cards for the success outcome`() async throws {
        let client = PreviewTCGCardsClient(outcome: .success(cards: PreviewTCGCardsClient.sampleCards))

        let cards = try await client.list().get()

        #expect(cards == PreviewTCGCardsClient.sampleCards)
    }

    @Test
    func `Should list no cards for the empty outcome`() async throws {
        let client = PreviewTCGCardsClient(outcome: .empty)

        let cards = try await client.list().get()

        #expect(cards.isEmpty)
    }

    @Test
    func `Should append created cards and reflect them in the list`() async throws {
        let client = PreviewTCGCardsClient(outcome: .empty)

        let createdCard = try await client.create(with: makePayload(name: "Roronoa Zoro")).get()

        let cards = try await client.list().get()
        #expect(createdCard.id == "preview-card-1")
        #expect(createdCard.name == "Roronoa Zoro")
        #expect(cards == [createdCard])
    }

    @Test
    func `Should replace an updated card`() async throws {
        let client = PreviewTCGCardsClient(outcome: .success(cards: PreviewTCGCardsClient.sampleCards))

        let updatedCard = try await client.update(id: "preview-card-1", with: makePayload(name: "Nami")).get()

        let cards = try await client.list().get()
        #expect(updatedCard.id == "preview-card-1")
        #expect(updatedCard.name == "Nami")
        #expect(cards.first == updatedCard)
        #expect(cards.count == PreviewTCGCardsClient.sampleCards.count)
    }

    @Test
    func `Should fail updating an unknown card with not found`() async throws {
        let client = PreviewTCGCardsClient(outcome: .success(cards: PreviewTCGCardsClient.sampleCards))

        let result = await client.update(id: "unknown-card", with: makePayload(name: "Nami"))

        try #require(throws: UpdateCardErrors.notFound) {
            try result.get()
        }
    }

    @Test
    func `Should remove a deleted card from the list`() async throws {
        let client = PreviewTCGCardsClient(outcome: .success(cards: PreviewTCGCardsClient.sampleCards))

        try await client.delete(id: "preview-card-1").get()

        let cards = try await client.list().get()
        #expect(cards.map(\.id) == ["preview-card-2"])
    }

    @Test
    func `Should fail deleting an unknown card with not found`() async throws {
        let client = PreviewTCGCardsClient(outcome: .empty)

        let result = await client.delete(id: "unknown-card")

        try #require(throws: DeleteCardErrors.notFound) {
            try result.get()
        }
    }

    @Test
    func `Should fail creation with the configured validation issues`() async throws {
        let issues = [TCGClientValidationIssue(code: "too_small", path: ["name"], message: "Name is required")]
        let client = PreviewTCGCardsClient(outcome: .validationErrors(issues))

        let result = await client.create(with: makePayload(name: ""))

        try #require(throws: CreateCardErrors.badRequest(validations: issues)) {
            try result.get()
        }
    }

    @Test
    func `Should fail updates with the configured validation issues`() async throws {
        let issues = [TCGClientValidationIssue(code: "too_small", path: ["name"], message: "Name is required")]
        let client = PreviewTCGCardsClient(outcome: .validationErrors(issues))

        let result = await client.update(id: "preview-card-1", with: makePayload(name: ""))

        try #require(throws: UpdateCardErrors.badRequest(validations: issues)) {
            try result.get()
        }
    }

    @Test
    func `Should fail updates for the not-found outcome`() async throws {
        let client = PreviewTCGCardsClient(outcome: .notFound)

        let result = await client.update(id: "preview-card-1", with: makePayload(name: "Nami"))

        try #require(throws: UpdateCardErrors.notFound) {
            try result.get()
        }
    }

    @Test
    func `Should fail deletions for the not-found outcome`() async throws {
        let client = PreviewTCGCardsClient(outcome: .notFound)

        let result = await client.delete(id: "preview-card-1")

        try #require(throws: DeleteCardErrors.notFound) {
            try result.get()
        }
    }

    @Test
    func `Should still list the sample cards for the not-found outcome`() async throws {
        let client = PreviewTCGCardsClient(outcome: .notFound)

        let cards = try await client.list().get()

        #expect(cards == PreviewTCGCardsClient.sampleCards)
    }

    @Test
    func `Should fail listing when the server is unavailable`() async throws {
        let client = PreviewTCGCardsClient(outcome: .serverUnavailable)

        let result = await client.list()

        try #require(throws: ListCardsErrors.unknown(status: 500, payload: nil, cause: nil)) {
            try result.get()
        }
    }

    @Test
    func `Should fail creation when the server is unavailable`() async throws {
        let client = PreviewTCGCardsClient(outcome: .serverUnavailable)

        let result = await client.create(with: makePayload(name: "Roronoa Zoro"))

        try #require(throws: CreateCardErrors.unknown(status: 500, payload: nil, cause: nil)) {
            try result.get()
        }
    }

    @Test
    func `Should fail updates when the server is unavailable`() async throws {
        let client = PreviewTCGCardsClient(outcome: .serverUnavailable)

        let result = await client.update(id: "preview-card-1", with: makePayload(name: "Nami"))

        try #require(throws: UpdateCardErrors.unknown(status: 500, payload: nil, cause: nil)) {
            try result.get()
        }
    }

    @Test
    func `Should fail deletions when the server is unavailable`() async throws {
        let client = PreviewTCGCardsClient(outcome: .serverUnavailable)

        let result = await client.delete(id: "preview-card-1")

        try #require(throws: DeleteCardErrors.unknown(status: 500, payload: nil, cause: nil)) {
            try result.get()
        }
    }

    @Test
    func `Should expose the cards through the preview TCGClient aggregate`() async throws {
        let client = TCGClient.preview(cardsOutcome: .success(cards: PreviewTCGCardsClient.sampleCards))

        let cards = try await client.cards.list().get()

        #expect(client.hasValidCredentials == true)
        #expect(cards == PreviewTCGCardsClient.sampleCards)
    }

    private func makePayload(name: String) -> UpsertCardPayload {
        UpsertCardPayload(
            game: .onePiece,
            name: name,
            setName: "Romance Dawn",
            cardNumber: "OP01-025",
            notes: nil,
            quantities: [CardConditionQuantity(condition: .nearMint, quantity: 1)]
        )
    }
}
