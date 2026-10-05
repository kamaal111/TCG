//
//  TCGCardsFeatureTests.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/20/26.
//

import Foundation
import HTTPTypes
import KamaalAuth
import OpenAPIRuntime
import Testing

@testable import TCGCards
@testable import TCGClient

@Suite("TCGCards Feature Tests")
@MainActor
struct TCGCardsFeatureTests {
    @Test(arguments: [false, true])
    func `A failed filter load retains only matching cached rows`(changeGame: Bool) async throws {
        let transport = PendingCollectionTransport()
        let feature = makePendingFeature(transport)
        let initialLoad = Task { await feature.load(game: nil) }
        await transport.waitForRequest("/app-api/cards")
        await transport.completeWithCachedCards("/app-api/cards")
        try await initialLoad.value.get()
        #expect(feature.cards.count == 2)

        let filteredLoad = Task {
            await feature.load(game: changeGame ? .pokemon : nil, setNames: changeGame ? [] : ["Base Set"])
        }
        let path = changeGame ? "/app-api/cards?game=pokemon" : "/app-api/cards?set_name=Base%20Set"
        await transport.waitForRequest(path)
        #expect(feature.cards.map(\.card.id) == ["pokemon-card"])
        #expect(feature.availableSetNames == (changeGame ? [] : ["Base Set", "Romance Dawn"]))
        await transport.complete(path, status: .serviceUnavailable)
        await #expect(throws: TCGCardsOperationError.serverUnavailable) { try await filteredLoad.value.get() }
        #expect(feature.cards.map(\.card.id) == ["pokemon-card"])
        #expect(feature.availableSetNames == (changeGame ? [] : ["Base Set", "Romance Dawn"]))
        #expect(!feature.hasLoadedCurrentCollection)
        #expect(!feature.isLoading)
    }

    @Test(arguments: [false, true])
    func `Batch deletion refreshes once and preserves partial failures`(secondDeleteFails: Bool) async throws {
        let transport = PendingCollectionTransport()
        let feature = makePendingFeature(transport)
        let initialLoad = Task { await feature.load(game: .pokemon, setNames: ["Base Set"]) }
        let listPath = "/app-api/cards?game=pokemon&set_name=Base%20Set"
        await transport.waitForRequest(listPath)
        await transport.complete(listPath, setName: "Base Set")
        try await initialLoad.value.get()

        let deletion = Task { await feature.deleteCards(ids: ["first-card", "second-card"]) }
        await transport.waitForRequest("/app-api/cards/first-card")
        await transport.complete("/app-api/cards/first-card", status: .ok)
        await transport.waitForRequest("/app-api/cards/second-card")
        #expect(await transport.requestCount == 3)
        await transport.complete(
            "/app-api/cards/second-card", status: secondDeleteFails ? .internalServerError : .ok
        )
        await transport.waitForRequest(listPath)
        await transport.complete(listPath, setName: "Remaining Set")
        let errors = await deletion.value
        #expect(errors == (secondDeleteFails ? [.serverUnavailable] : []))
        #expect(await transport.requestCount == 4)
        #expect(feature.availableSetNames == ["Remaining Set"])
        #expect(feature.hasLoadedCurrentCollection)
    }

    @Test
    func `A failed mutation refresh retries when the loaded screen resumes`() async throws {
        let transport = PendingCollectionTransport()
        let feature = makePendingFeature(transport)
        let model = TCGCardsListScreenModel()
        let initialLoad = Task { await model.load(using: feature) }
        await transport.waitForRequest("/app-api/cards")
        await transport.complete("/app-api/cards", setName: "Base Set")
        await initialLoad.value

        let deletion = Task { await feature.deleteCard(id: "deleted-card") }
        await transport.waitForRequest("/app-api/cards/deleted-card")
        await transport.complete("/app-api/cards/deleted-card", status: .ok)
        await transport.waitForRequest("/app-api/cards")
        await transport.complete("/app-api/cards", status: .serviceUnavailable)
        try await deletion.value.get()
        #expect(feature.availableSetNames == ["Base Set"])
        #expect(!feature.hasLoadedCurrentCollection)

        let resumedLoad = Task { await model.resumeLoadIfNeeded(using: feature) }
        await transport.waitForRequest("/app-api/cards")
        await transport.complete("/app-api/cards", setName: "Remaining Set")
        await resumedLoad.value
        #expect(feature.availableSetNames == ["Remaining Set"])
        #expect(feature.hasLoadedCurrentCollection)
        #expect(await transport.requestCount == 4)
        await model.resumeLoadIfNeeded(using: feature)
        #expect(await transport.requestCount == 4)
    }

    @Test
    func `A cancelled initial load remains retryable when the screen resumes`() async {
        let transport = PendingCollectionTransport()
        let feature = makePendingFeature(transport)
        let model = TCGCardsListScreenModel()
        let cancelledLoad = Task { await model.load(using: feature) }
        await transport.waitForRequest("/app-api/cards")
        cancelledLoad.cancel()
        await transport.complete("/app-api/cards", setName: "Base Set")
        await cancelledLoad.value
        #expect(feature.availableSetNames.isEmpty)
        #expect(!feature.isLoading)

        let resumedLoad = Task { await model.resumeLoadIfNeeded(using: feature) }
        await transport.waitForRequest("/app-api/cards")
        await transport.complete("/app-api/cards", setName: "Base Set")
        await resumedLoad.value

        #expect(await transport.requestCount == 2)
        #expect(feature.availableSetNames == ["Base Set"])
    }

    @Test
    func `Resuming a preloaded screen skips the duplicate request and still reloads changed sets`() async {
        let transport = PendingCollectionTransport()
        let feature = makePendingFeature(transport)
        let model = TCGCardsListScreenModel()
        let initialLoad = Task { await model.load(using: feature) }
        await transport.waitForRequest("/app-api/cards")
        await transport.complete("/app-api/cards", setName: "Base Set")
        await initialLoad.value

        await model.resumeLoadIfNeeded(using: feature)
        #expect(await transport.requestCount == 1)
        #expect(!feature.isLoading)

        model.setNames = ["Base Set"]
        let changedLoad = Task { await model.resumeLoadIfNeeded(using: feature) }
        await transport.waitForRequest("/app-api/cards?set_name=Base%20Set")
        await transport.complete("/app-api/cards?set_name=Base%20Set", setName: "Base Set")
        await changedLoad.value

        #expect(await transport.requestCount == 2)
        #expect(feature.availableSetNames == ["Base Set"])
    }

    @Test
    func `A superseded load cannot replace a newer collection`() async throws {
        let transport = PendingCollectionTransport()
        let feature = makePendingFeature(transport)
        let oldLoad = Task { await feature.load(game: .pokemon) }
        await transport.waitForRequest("/app-api/cards?game=pokemon")
        let newLoad = Task { await feature.load(game: .onePiece) }
        await transport.waitForRequest("/app-api/cards?game=one_piece")

        await transport.complete("/app-api/cards?game=one_piece", setName: "Romance Dawn")
        try await newLoad.value.get()
        #expect(feature.availableSetNames == ["Romance Dawn"])
        #expect(!feature.isLoading)

        await transport.complete("/app-api/cards?game=pokemon", setName: "Base Set")
        try await oldLoad.value.get()
        #expect(feature.availableSetNames == ["Romance Dawn"])
        #expect(!feature.isLoading)
    }

    @Test
    func `A superseded response cannot dismiss the current loading indicator`() async throws {
        let transport = PendingCollectionTransport()
        let feature = makePendingFeature(transport)
        let oldLoad = Task { await feature.load(game: .pokemon) }
        await transport.waitForRequest("/app-api/cards?game=pokemon")
        let newLoad = Task { await feature.load(game: .onePiece) }
        await transport.waitForRequest("/app-api/cards?game=one_piece")

        await transport.complete("/app-api/cards?game=pokemon", setName: "Base Set")
        try await oldLoad.value.get()
        #expect(feature.availableSetNames.isEmpty)
        #expect(feature.isLoading)

        await transport.complete("/app-api/cards?game=one_piece", setName: "Romance Dawn")
        try await newLoad.value.get()
        #expect(feature.availableSetNames == ["Romance Dawn"])
        #expect(!feature.isLoading)
    }

    @Test
    func `Load populates cards with prices`() async throws {
        let feature = makeFeature(.success(cards: PreviewTCGCardsClient.sampleCards))
        try await feature.load(game: nil).get()
        #expect(feature.cards.map(\.card) == PreviewTCGCardsClient.sampleCards)
        #expect(feature.cards.map(\.price) == PreviewTCGCardsClient.sampleCards.map(PreviewTCGCardsClient.price))
    }

    @Test
    func `Empty load clears cards`() async throws {
        let feature = makeFeature(.empty)
        try await feature.load(game: nil).get()
        #expect(feature.cards.isEmpty)
    }

    @Test
    func `Load requests cards and prices for the selected game`() async throws {
        let feature = makeFeature(.success(cards: PreviewTCGCardsClient.sampleCards))

        try await feature.load(game: .pokemon).get()

        #expect(feature.cards.map(\.card.id) == ["preview-card-2"])
        #expect(feature.cards.map(\.price.cardId) == ["preview-card-2"])
    }

    @Test
    func `Add update and delete mutate the collection`() async throws {
        let feature = makeFeature(.empty)
        try await feature.addCard(validValues).get()
        let cardWithPrice = try #require(feature.cards.first)
        var updated = validValues
        updated.name = "Updated"
        _ = try await feature.updateCard(id: cardWithPrice.card.id, values: updated).get()
        #expect(feature.cards.first?.card.name == "Updated")
        try await feature.deleteCard(id: cardWithPrice.card.id).get()
        #expect(feature.cards.isEmpty)
    }

    @Test
    func `Adding a card fetches and merges only that card's price`() async throws {
        let feature = makeFeature(.empty)

        try await feature.addCard(validValues).get()
        let card = try #require(feature.cards.first)

        #expect(feature.cards.map(\.card.id) == [card.card.id])
        #expect(card.price == PreviewTCGCardsClient.price(for: card.card))
    }

    @Test
    func `Updating a card merges its refreshed price without clearing other prices`() async throws {
        let feature = makeFeature(.success(cards: PreviewTCGCardsClient.sampleCards))
        try await feature.load(game: nil).get()
        let otherCardId = try #require(PreviewTCGCardsClient.sampleCards.first { $0.id != "preview-card-1" }?.id)
        let priceBeforeUpdate = feature.cards.first { $0.card.id == otherCardId }?.price

        var updated = validValues
        updated.name = "Updated"
        _ = try await feature.updateCard(id: "preview-card-1", values: updated).get()

        #expect(feature.cards.first { $0.card.id == "preview-card-1" }?.price != nil)
        #expect(feature.cards.first { $0.card.id == otherCardId }?.price == priceBeforeUpdate)
    }

    @Test
    func `Load returns a cards failure`() async {
        let feature = makeFeature(.serverUnavailable)
        await #expect(throws: TCGCardsOperationError.serverUnavailable) { try await feature.load(game: nil).get() }
    }

    @Test
    func `Pricing stays attached to its card`() async throws {
        let feature = makeFeature(.success(cards: PreviewTCGCardsClient.sampleCards))

        try await feature.load(game: nil).get()

        #expect(feature.cards.allSatisfy { $0.card.id == $0.price.cardId })
    }

    @Test
    func `Missing update fails`() async {
        let feature = makeFeature(.notFound)
        await #expect(throws: TCGCardsOperationError.notFound) {
            try await feature.updateCard(id: "preview-card-1", values: validValues).get()
        }
    }

    private func makeFeature(_ outcome: PreviewTCGCardsOutcome) -> TCGCards {
        TCGCards(client: .preview(cardsOutcome: outcome))
    }

    private func makePendingFeature(_ transport: PendingCollectionTransport) -> TCGCards {
        let credentials = Credentials(
            authToken: "auth-token", authTokenExpiryDate: .distantFuture,
            sessionToken: "session-token", sessionUpdateAge: 1800, lastSessionUpdate: .now
        )
        return TCGCards(
            client: .default(
                transport: transport, credentialsKeychainKey: "collection-load-tests",
                credentialsStore: InMemoryCredentialsStore(seed: try? JSONEncoder().encode(credentials))
            )
        )
    }
}

private actor PendingCollectionTransport: ClientTransport {
    private(set) var requestCount = 0
    private var pending: [String: CheckedContinuation<(HTTPResponse, HTTPBody?), Never>] = [:]
    private var waiters: [String: CheckedContinuation<Void, Never>] = [:]

    func send(
        _ request: HTTPRequest, body _: HTTPBody?, baseURL _: URL, operationID _: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        guard let path = request.path else { preconditionFailure("Collection requests require a path.") }
        requestCount += 1
        return await withCheckedContinuation { continuation in
            pending[path] = continuation
            waiters.removeValue(forKey: path)?.resume()
        }
    }

    func waitForRequest(_ path: String) async {
        if pending[path] != nil { return }
        await withCheckedContinuation { waiters[path] = $0 }
    }

    func complete(_ path: String, setName: String) {
        guard let continuation = pending.removeValue(forKey: path) else {
            preconditionFailure("A collection request must be pending before completion.")
        }
        let body = """
            {"cards": [], "available_set_names": ["\(setName)"]}
            """
        continuation.resume(returning: (HTTPResponse(status: .ok), HTTPBody(body)))
    }

    func complete(_ path: String, status: HTTPResponse.Status) {
        guard let continuation = pending.removeValue(forKey: path) else {
            preconditionFailure("A collection request must be pending before completion.")
        }
        continuation.resume(returning: (HTTPResponse(status: status), HTTPBody("{}")))
    }

    func completeWithCachedCards(_ path: String) {
        guard let continuation = pending.removeValue(forKey: path) else {
            preconditionFailure("A collection request must be pending before completion.")
        }
        let body = """
            {"cards": [
              {"id": "pokemon-card", "game": "pokemon", "name": "Pikachu",
               "set_name": "Base Set", "card_number": "58/102", "notes": null, "quantities": [],
               "created_at": "2026-07-20T10:30:00.000Z", "updated_at": "2026-07-20T10:30:00.000Z",
               "price": {"card_id": "pokemon-card", "status": "no_price"}},
              {"id": "one-piece-card", "game": "one_piece", "name": "Luffy",
               "set_name": "Romance Dawn", "card_number": "OP01-003", "notes": null, "quantities": [],
               "created_at": "2026-07-20T10:30:00.000Z", "updated_at": "2026-07-20T10:30:00.000Z",
               "price": {"card_id": "one-piece-card", "status": "no_price"}}
            ], "available_set_names": ["Base Set", "Romance Dawn"]}
            """
        continuation.resume(returning: (HTTPResponse(status: .ok), HTTPBody(body)))
    }
}

var validValues: CardFormValues {
    CardFormValues(
        game: .onePiece,
        name: "Monkey D. Luffy",
        setName: "Romance Dawn",
        cardNumber: "OP01-003",
        notes: "",
        quantities: [.nearMint: 2]
    )
}
