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
import TCGCurrency
import Testing

@testable import TCGCards
@testable import TCGClient

@Suite("TCGCards Feature Tests")
@MainActor
struct TCGCardsFeatureTests {
    @Test
    func `Changing currency discards a delayed collection response`() async throws {
        let transport = PendingCollectionTransport()
        let feature = makePendingFeature(transport)
        let currency = TCGCurrency(client: .preview(), defaults: nil)
        await feature.refreshDisplayPrices(for: currency.displayIdentity)
        let original = Task { await feature.load(game: nil) }
        await transport.waitForRequest("/app-api/cards")
        #expect(await currency.save(.eur))
        let refresh = Task { await feature.refreshDisplayPrices(for: currency.displayIdentity) }
        await transport.waitForRequests("/app-api/cards", count: 2)
        #expect(feature.cards.isEmpty)
        await transport.completePage(
            "/app-api/cards",
            id: CardsTestIDs.oldCurrencyCard,
            cursor: nil
        )
        try await original.value.get()
        #expect(feature.cards.isEmpty)
        #expect(feature.isLoading)
        await transport.completePage(
            "/app-api/cards",
            id: CardsTestIDs.newCurrencyCard,
            cursor: nil
        )
        await refresh.value
        #expect(feature.cards.map(\.card.id) == [CardsTestIDs.newCurrencyCard])
        #expect(feature.displayRefreshError == nil)
    }

    @Test
    func `A failed currency refresh leaves no old collection prices`() async throws {
        let transport = PendingCollectionTransport()
        let feature = makePendingFeature(transport)
        let currency = TCGCurrency(client: .preview(), defaults: nil)
        await feature.refreshDisplayPrices(for: currency.displayIdentity)
        let original = Task { await feature.load(game: nil) }
        await transport.waitForRequest("/app-api/cards")
        await transport.completePage(
            "/app-api/cards",
            id: CardsTestIDs.oldCurrencyCard,
            cursor: nil
        )
        try await original.value.get()
        #expect(await currency.save(.eur))
        let refresh = Task { await feature.refreshDisplayPrices(for: currency.displayIdentity) }
        await transport.waitForRequest("/app-api/cards")
        #expect(feature.cards.isEmpty)
        await transport.complete("/app-api/cards", status: .serviceUnavailable)
        await refresh.value
        #expect(feature.cards.isEmpty)
        #expect(feature.displayRefreshError == .serverUnavailable)
    }

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
        #expect(feature.cards.map(\.card.id) == [CardsTestIDs.cachedPokemon])
        #expect(feature.availableSetNames == (changeGame ? [] : ["Base Set", "Romance Dawn"]))
        await transport.complete(path, status: .serviceUnavailable)
        await #expect(throws: TCGCardsOperationError.serverUnavailable) { try await filteredLoad.value.get() }
        #expect(feature.cards.map(\.card.id) == [CardsTestIDs.cachedPokemon])
        #expect(feature.availableSetNames == (changeGame ? [] : ["Base Set", "Romance Dawn"]))
        #expect(!feature.hasLoadedCurrentCollection)
        #expect(!feature.isLoading)
    }

    @Test(arguments: [
        (
            [
                CardsTestIDs.cachedPokemon,
                CardsTestIDs.cachedOnePiece,
            ], [], []
        ),
        (
            [CardsTestIDs.cachedPokemon],
            [CardsTestIDs.cachedOnePiece], [TCGCardsOperationError.notFound]
        ),
    ])
    func `Batch deletion uses one request and refreshes once`(scenario: ([UUID], [UUID], [TCGCardsOperationError]))
        async throws
    {
        let (deletedIDs, notFoundIDs, expectedErrors) = scenario
        let transport = PendingCollectionTransport()
        let feature = makePendingFeature(transport)
        let initialLoad = Task { await feature.load(game: .pokemon, setNames: ["Base Set"]) }
        let listPath = "/app-api/cards?game=pokemon&set_name=Base%20Set"
        await transport.waitForRequest(listPath)
        await transport.completeWithCachedCards(listPath)
        try await initialLoad.value.get()

        let deletion = Task {
            await feature.deleteCards(ids: [
                CardsTestIDs.cachedPokemon,
                CardsTestIDs.cachedOnePiece,
            ])
        }
        await transport.waitForRequest("/app-api/cards")
        #expect(await transport.requestCount == 2)
        try await transport.completeDeletion(deletedIDs: deletedIDs, notFoundIDs: notFoundIDs)
        await transport.waitForRequest(listPath)
        #expect(feature.cards.isEmpty)
        await transport.complete(listPath, setName: "Remaining Set")
        #expect(await deletion.value == expectedErrors)
        #expect(await transport.requestCount == 3)
        #expect(feature.availableSetNames == ["Remaining Set"])
        #expect(feature.hasLoadedCurrentCollection)
    }

    @Test
    func `Empty deletion sends no requests`() async {
        let transport = PendingCollectionTransport()
        let feature = makePendingFeature(transport)
        #expect(await feature.deleteCards(ids: []).isEmpty)
        #expect(await transport.requestCount == 0)
    }

    @Test
    func `Missing deletion targets preserve cached rows without refreshing`() async throws {
        let transport = PendingCollectionTransport()
        let feature = try await loadCards(transport, response: .cached).get()
        let cached = feature.cards
        let deletion = Task {
            await feature.deleteCards(ids: [
                CardsTestIDs.third,
                CardsTestIDs.third,
            ])
        }
        await transport.waitForRequest("/app-api/cards")
        try await transport.completeDeletion(
            deletedIDs: [],
            notFoundIDs: [CardsTestIDs.third]
        )
        #expect(await deletion.value == [.notFound])
        #expect(feature.cards == cached)
        #expect(feature.hasLoadedCurrentCollection)
        #expect(await transport.requestCount == 2)
    }

    @Test
    func `Failed deletion requests preserve cached rows without refreshing`() async throws {
        let transport = PendingCollectionTransport()
        let feature = try await loadCards(transport, response: .cached).get()
        let cached = feature.cards
        let deletion = Task {
            await feature.deleteCards(ids: [CardsTestIDs.cachedPokemon])
        }
        await transport.waitForRequest("/app-api/cards")
        await transport.complete("/app-api/cards", status: .internalServerError)
        #expect(await deletion.value == [.serverUnavailable])
        #expect(feature.cards == cached)
        #expect(feature.hasLoadedCurrentCollection)
        #expect(await transport.requestCount == 2)
    }

    @Test
    func `A failed deletion refresh retains successful deletion and retries on resume`() async throws {
        let transport = PendingCollectionTransport()
        let feature = makePendingFeature(transport)
        let model = TCGCardsListScreenModel(preferences: nil)
        let load = Task { await model.load(using: feature) }
        await transport.waitForRequest("/app-api/cards")
        await transport.completeWithCachedCards("/app-api/cards")
        await load.value
        let deletion = Task {
            await feature.deleteCards(ids: [CardsTestIDs.cachedPokemon])
        }
        await transport.waitForRequest("/app-api/cards")
        try await transport.completeDeletion(
            deletedIDs: [CardsTestIDs.cachedPokemon],
            notFoundIDs: []
        )
        await transport.waitForRequest("/app-api/cards")
        await transport.complete("/app-api/cards", status: .serviceUnavailable)
        #expect(await deletion.value.isEmpty)
        #expect(feature.cards.map(\.card.id) == [CardsTestIDs.cachedOnePiece])
        #expect(!feature.hasLoadedCurrentCollection)
        let resumed = Task { await model.resumeLoadIfNeeded(using: feature) }
        await transport.waitForRequest("/app-api/cards")
        await transport.complete("/app-api/cards", setName: "Remaining Set")
        await resumed.value
        #expect(feature.hasLoadedCurrentCollection)
        #expect(await transport.requestCount == 4)
    }

    @Test
    func `A missing single deletion preserves cached rows and returns not found`() async throws {
        let transport = PendingCollectionTransport()
        let feature = try await loadCards(transport, response: .cached).get()
        let cached = feature.cards
        let deletion = Task {
            await feature.deleteCard(id: CardsTestIDs.cachedPokemon)
        }
        await transport.waitForRequest("/app-api/cards")
        try await transport.completeDeletion(
            deletedIDs: [],
            notFoundIDs: [CardsTestIDs.cachedPokemon]
        )
        await #expect(throws: TCGCardsOperationError.notFound) { try await deletion.value.get() }
        #expect(feature.cards == cached)
        #expect(feature.hasLoadedCurrentCollection)
        #expect(await transport.requestCount == 2)
        #expect(await transport.deletionIDs == [[CardsTestIDs.cachedPokemon]])
    }

    @Test
    func `A failed mutation refresh retries when the loaded screen resumes`() async throws {
        let transport = PendingCollectionTransport()
        let feature = makePendingFeature(transport)
        let model = TCGCardsListScreenModel(preferences: nil)
        let initialLoad = Task { await model.load(using: feature) }
        await transport.waitForRequest("/app-api/cards")
        await transport.complete("/app-api/cards", setName: "Base Set")
        await initialLoad.value

        let deletion = Task {
            await feature.deleteCard(id: CardsTestIDs.createdCard)
        }
        await transport.waitForRequest("/app-api/cards")
        try await transport.completeDeletion(
            deletedIDs: [CardsTestIDs.createdCard],
            notFoundIDs: []
        )
        #expect(await transport.deletionIDs == [[CardsTestIDs.createdCard]])
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
        let model = TCGCardsListScreenModel(preferences: nil)
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
        let model = TCGCardsListScreenModel(preferences: nil)
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

        #expect(feature.cards.map(\.card.id) == [CardsTestIDs.secondary])
        #expect(feature.cards.map(\.price.cardId) == [CardsTestIDs.secondary])
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
        let otherCardId = try #require(
            PreviewTCGCardsClient.sampleCards.first {
                $0.id != CardsTestIDs.primary
            }?.id
        )
        let priceBeforeUpdate = feature.cards.first { $0.card.id == otherCardId }?.price

        var updated = validValues
        updated.name = "Updated"
        _ = try await feature.updateCard(
            id: CardsTestIDs.primary,
            values: updated
        )
        .get()

        #expect(
            feature.cards.first { $0.card.id == CardsTestIDs.primary }?.price
                != nil
        )
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
            try await feature.updateCard(
                id: CardsTestIDs.primary,
                values: validValues
            )
            .get()
        }
    }

    private func makeFeature(_ outcome: PreviewTCGCardsOutcome) -> TCGCards {
        TCGCards(client: .preview(cardsOutcome: outcome))
    }

    @Test
    func `Collection fetches only the first page and serializes subsequent loads`() async throws {
        let transport = PendingCollectionTransport()
        let feature = try await loadCards(transport, response: .paginated).get()
        #expect(feature.cards.map(\.card.id) == [CardsTestIDs.firstPageCard])
        #expect(feature.hasMoreCards)
        #expect(await transport.requestCount == 1)

        let next = Task { await feature.loadNextPage() }
        await transport.waitForRequest("/app-api/cards?cursor=page-two")
        #expect(feature.isLoadingNextPage)
        try await feature.loadNextPage().get()
        #expect(await transport.requestCount == 2)
        await transport.completePage(
            "/app-api/cards?cursor=page-two",
            id: CardsTestIDs.secondPageCard,
            cursor: nil
        )
        try await next.value.get()
        #expect(
            feature.cards.map(\.card.id) == [
                CardsTestIDs.firstPageCard,
                CardsTestIDs.secondPageCard,
            ]
        )
        #expect(feature.availableSetNames == ["Base Set", "Crown Zenith"])
        #expect(!feature.hasMoreCards)
        #expect(!feature.isLoadingNextPage)
    }

    @Test
    func `A failed subsequent page preserves rows and retries the same cursor`() async throws {
        let transport = PendingCollectionTransport()
        let feature = try await loadCards(transport, response: .paginated).get()

        let next = Task { await feature.loadNextPage() }
        await transport.waitForRequest("/app-api/cards?cursor=page-two")
        await transport.complete("/app-api/cards?cursor=page-two", status: .serviceUnavailable)
        await #expect(throws: TCGCardsOperationError.serverUnavailable) { try await next.value.get() }
        #expect(feature.nextPageError == .serverUnavailable)
        #expect(feature.cards.map(\.card.id) == [CardsTestIDs.firstPageCard])
        #expect(feature.hasMoreCards)
        #expect(!feature.isLoadingNextPage)

        let retry = Task { await feature.loadNextPage() }
        await transport.waitForRequest("/app-api/cards?cursor=page-two")
        await transport.completePage(
            "/app-api/cards?cursor=page-two",
            id: CardsTestIDs.secondPageCard,
            cursor: nil
        )
        try await retry.value.get()
        #expect(
            feature.cards.map(\.card.id) == [
                CardsTestIDs.firstPageCard,
                CardsTestIDs.secondPageCard,
            ]
        )
        #expect(feature.nextPageError == nil)
    }

    @Test
    func `Filter changes ignore an in-flight page from the previous collection`() async throws {
        let transport = PendingCollectionTransport()
        let feature = try await loadCards(transport, response: .paginated).get()
        let oldPage = Task { await feature.loadNextPage() }
        await transport.waitForRequest("/app-api/cards?cursor=page-two")
        let filtered = Task { await feature.load(game: .onePiece) }
        await transport.waitForRequest("/app-api/cards?game=one_piece")
        await transport.complete("/app-api/cards?game=one_piece", setName: "Romance Dawn")
        try await filtered.value.get()
        await transport.completePage(
            "/app-api/cards?cursor=page-two",
            id: CardsTestIDs.newFilterCard,
            cursor: "stale-cursor"
        )
        try await oldPage.value.get()
        #expect(feature.cards.isEmpty)
        #expect(feature.availableSetNames == ["Romance Dawn"])
        #expect(!feature.hasMoreCards)
        #expect(!feature.isLoadingNextPage)
    }

    @Test
    func `Cancelled subsequent pages do not publish their rows`() async throws {
        let transport = PendingCollectionTransport()
        let feature = try await loadCards(transport, response: .paginated).get()
        let next = Task { await feature.loadNextPage() }
        await transport.waitForRequest("/app-api/cards?cursor=page-two")
        next.cancel()
        await transport.completePage(
            "/app-api/cards?cursor=page-two",
            id: CardsTestIDs.oldFilterCard,
            cursor: nil
        )
        try await next.value.get()
        #expect(feature.cards.map(\.card.id) == [CardsTestIDs.firstPageCard])
        #expect(feature.hasMoreCards)
        #expect(!feature.isLoadingNextPage)
        #expect(feature.nextPageError == nil)
    }

    @Test
    func `Refresh preserves loaded depth and publishes the replacement pages together`() async throws {
        let transport = PendingCollectionTransport()
        let feature = try await loadCards(transport, response: .paginated).get()
        let next = Task { await feature.loadNextPage() }
        await transport.waitForRequest("/app-api/cards?cursor=page-two")
        await transport.completePage(
            "/app-api/cards?cursor=page-two",
            id: CardsTestIDs.secondPageCard,
            cursor: "page-three"
        )
        try await next.value.get()

        let refresh = Task { await feature.retryImportRefresh() }
        await transport.waitForRequest("/app-api/cards")
        await transport.completePage(
            "/app-api/cards",
            id: CardsTestIDs.staleCard,
            cursor: "new-page-two"
        )
        await transport.waitForRequest("/app-api/cards?cursor=new-page-two")
        #expect(
            feature.cards.map(\.card.id) == [
                CardsTestIDs.firstPageCard,
                CardsTestIDs.secondPageCard,
            ]
        )
        await transport.completePage(
            "/app-api/cards?cursor=new-page-two",
            id: CardsTestIDs.freshCard,
            cursor: "new-page-three"
        )
        #expect(await refresh.value)
        #expect(
            feature.cards.map(\.card.id) == [
                CardsTestIDs.staleCard,
                CardsTestIDs.freshCard,
            ]
        )
        #expect(feature.hasMoreCards)
        #expect(await transport.requestCount == 4)
    }

    @Test
    func `Scrolling and refresh deduplicate cards while retaining page depth`() async throws {
        let transport = PendingCollectionTransport()
        let feature = makePendingFeature(transport)
        let initial = Task { await feature.load(game: nil) }
        await transport.waitForRequest("/app-api/cards")
        await transport.completePage(
            "/app-api/cards",
            id: CardsTestIDs.loadedCard,
            cursor: "page-two"
        )
        try await initial.value.get()

        let next = Task { await feature.loadNextPage() }
        await transport.waitForRequest("/app-api/cards?cursor=page-two")
        await transport.completePage(
            "/app-api/cards?cursor=page-two",
            id: CardsTestIDs.loadedCard,
            cursor: nil
        )
        try await next.value.get()
        #expect(feature.cards.map(\.card.id) == [CardsTestIDs.loadedCard])
        #expect(!feature.hasMoreCards)

        let refresh = Task { await feature.retryImportRefresh() }
        await transport.waitForRequest("/app-api/cards")
        await transport.completePage(
            "/app-api/cards",
            id: CardsTestIDs.updatedCard,
            cursor: "new-page-two"
        )
        await transport.waitForRequest("/app-api/cards?cursor=new-page-two")
        #expect(feature.cards.map(\.card.id) == [CardsTestIDs.loadedCard])
        await transport.completePage(
            "/app-api/cards?cursor=new-page-two",
            id: CardsTestIDs.updatedCard,
            cursor: nil
        )
        #expect(await refresh.value)
        #expect(feature.cards.map(\.card.id) == [CardsTestIDs.updatedCard])
        #expect(feature.availableSetNames == ["Base Set", "Crown Zenith"])
        #expect(!feature.hasMoreCards)
        #expect(await transport.requestCount == 4)
    }

    @Test
    func `Repeating subsequent cursors fail without changing the loaded cards`() async throws {
        let transport = PendingCollectionTransport()
        let feature = makePendingFeature(transport)
        let initial = Task { await feature.load(game: nil) }
        await transport.waitForRequest("/app-api/cards")
        await transport.completePage(
            "/app-api/cards",
            id: CardsTestIDs.firstPageCard,
            cursor: "same"
        )
        try await initial.value.get()
        let next = Task { await feature.loadNextPage() }
        await transport.waitForRequest("/app-api/cards?cursor=same")
        await transport.completePage(
            "/app-api/cards?cursor=same",
            id: CardsTestIDs.secondPageCard,
            cursor: "same"
        )
        await #expect(throws: TCGCardsOperationError.serverUnavailable) { try await next.value.get() }
        #expect(feature.cards.map(\.card.id) == [CardsTestIDs.firstPageCard])
        #expect(feature.nextPageError == .serverUnavailable)
    }

    private enum InitialCards {
        case paginated, cached
    }

    private func loadCards(_ transport: PendingCollectionTransport, response: InitialCards) async -> Result<
        TCGCards, TCGCardsOperationError
    > {
        let feature = makePendingFeature(transport)
        let initial = Task { await feature.load(game: nil) }
        await transport.waitForRequest("/app-api/cards")
        switch response {
        case .paginated:
            await transport.completePage("/app-api/cards", id: CardsTestIDs.firstPageCard, cursor: "page-two")
        case .cached:
            await transport.completeWithCachedCards("/app-api/cards")
        }
        return await initial.value.map { feature }
    }

    private func makePendingFeature(_ transport: PendingCollectionTransport) -> TCGCards {
        let credentials = Credentials(
            authToken: "auth-token",
            authTokenExpiryDate: .distantFuture,
            sessionToken: "session-token",
            sessionUpdateAge: 1800,
            lastSessionUpdate: .now
        )
        return TCGCards(
            client: .default(
                transport: transport,
                credentialsKeychainKey: "collection-load-tests",
                credentialsStore: InMemoryCredentialsStore(seed: try? JSONEncoder().encode(credentials))
            )
        )
    }
}

private actor PendingCollectionTransport: ClientTransport {
    private(set) var requestCount = 0
    private(set) var deletionIDs: [[UUID]] = []
    private var pending: [String: [CheckedContinuation<(HTTPResponse, HTTPBody?), Never>]] = [:]
    private var pendingCountWaiters: [String: (Int, CheckedContinuation<Void, Never>)] = [:]
    private var waiters: [String: CheckedContinuation<Void, Never>] = [:]

    func send(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL _: URL,
        operationID _: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        guard let path = request.path else { preconditionFailure("Collection requests require a path.") }
        requestCount += 1
        if request.method == .delete {
            guard let body else { preconditionFailure("Deletion requests require a body.") }
            let data = try await Data(collecting: body, upTo: .max)
            deletionIDs.append(try JSONDecoder().decode(DeleteCardsPayload.self, from: data).cardIDs)
        }
        return await withCheckedContinuation { continuation in
            pending[path, default: []].append(continuation)
            if let (count, waiter) = pendingCountWaiters[path], pending[path, default: []].count >= count {
                pendingCountWaiters.removeValue(forKey: path)
                waiter.resume()
            }
            waiters.removeValue(forKey: path)?.resume()
        }
    }

    func waitForRequest(_ path: String) async {
        if pending[path] != nil { return }
        await withCheckedContinuation { waiters[path] = $0 }
    }

    func waitForRequests(_ path: String, count: Int) async {
        if pending[path, default: []].count >= count { return }
        await withCheckedContinuation { pendingCountWaiters[path] = (count, $0) }
    }

    private func takeRequest(_ path: String) -> CheckedContinuation<(HTTPResponse, HTTPBody?), Never> {
        guard var requests = pending[path], !requests.isEmpty else {
            preconditionFailure("A collection request must be pending before completion.")
        }
        let request = requests.removeFirst()
        pending[path] = requests.isEmpty ? nil : requests
        return request
    }

    func complete(_ path: String, setName: String) {
        let continuation = takeRequest(path)
        let body = """
            {"cards": [], "available_set_names": ["\(setName)"], "next_cursor": null}
            """
        continuation.resume(returning: (HTTPResponse(status: .ok), HTTPBody(body)))
    }

    func complete(_ path: String, status: HTTPResponse.Status) {
        let continuation = takeRequest(path)
        continuation.resume(returning: (HTTPResponse(status: status), HTTPBody("{}")))
    }

    func completePage(_ path: String, id: UUID, cursor: String?) {
        let continuation = takeRequest(path)
        let nextCursor = cursor.map { "\"\($0)\"" } ?? "null"
        let body = """
            {
              "cards": [{
                "id": "\(id)", "game": "pokemon", "name": "Pikachu",
                "set_name": "Base Set", "card_number": "58/102", "notes": null,
                "purchases": [], "purchase_price_change_percent": null,
                "created_at": "2026-07-20T10:30:00.000Z", "updated_at": "2026-07-20T10:30:00.000Z",
                "price": {"card_id": "\(id)", "status": "no_price"}
              }],
              "available_set_names": ["Base Set", "Crown Zenith"],
              "next_cursor": \(nextCursor)
            }
            """
        continuation.resume(returning: (HTTPResponse(status: .ok), HTTPBody(body)))
    }

    func completeDeletion(deletedIDs: [UUID], notFoundIDs: [UUID]) throws {
        let path = "/app-api/cards"
        let continuation = takeRequest(path)
        let body = try JSONSerialization.data(withJSONObject: [
            "deleted_ids": deletedIDs.map { $0.uuidString.lowercased() },
            "not_found_ids": notFoundIDs.map { $0.uuidString.lowercased() },
        ])
        continuation.resume(returning: (HTTPResponse(status: .ok), HTTPBody(body)))
    }

    func completeWithCachedCards(_ path: String) {
        let continuation = takeRequest(path)
        let body = """
            {"cards": [
              {"id": "00000000-0000-4000-8000-000000000060", "game": "pokemon", "name": "Pikachu",
               "set_name": "Base Set", "card_number": "58/102", "notes": null, "purchases": [], "purchase_price_change_percent": null,
               "created_at": "2026-07-20T10:30:00.000Z", "updated_at": "2026-07-20T10:30:00.000Z",
               "price": {"card_id": "00000000-0000-4000-8000-000000000060", "status": "no_price"}},
              {"id": "00000000-0000-4000-8000-000000000061", "game": "one_piece", "name": "Luffy",
               "set_name": "Romance Dawn", "card_number": "OP01-003", "notes": null, "purchases": [], "purchase_price_change_percent": null,
               "created_at": "2026-07-20T10:30:00.000Z", "updated_at": "2026-07-20T10:30:00.000Z",
               "price": {"card_id": "00000000-0000-4000-8000-000000000061", "status": "no_price"}}
            ], "available_set_names": ["Base Set", "Romance Dawn"], "next_cursor": null}
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
