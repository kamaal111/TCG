import Foundation
import HTTPTypes
import OpenAPIRuntime
import Testing

@testable import TCGCards
@testable import TCGClient

@MainActor
struct BinderCardPaginationTests {
    @Test func `Search starts a fresh server query and ignores a delayed previous page`() async throws {
        let context = try await makeContext()
        let initial = Task { await context.model.load(using: context.cards, collections: context.collections) }
        await context.transport.waitForRequests(1)
        try await context.transport.complete(0, cards: [Self.entries[0]], cursor: "next")
        await initial.value
        #expect(context.model.availableCards == [Self.entries[0]])
        try #require(context.model.hasMoreCards)
        #expect(await context.transport.paths.count == 1)
        let oldPage = Task { await context.model.loadNextPage(using: context.cards) }
        await context.transport.waitForRequests(2)
        context.model.setQuery("Pikachu")
        let search = Task { await context.model.search(using: context.cards, collections: context.collections) }
        await context.transport.waitForRequests(3)
        let paths = await context.transport.paths
        #expect(paths[2].contains("query=Pikachu"))
        #expect(!paths[2].contains("cursor="))
        context.model.setQuery(" Pikachu ")
        await context.model.search(using: context.cards, collections: context.collections)
        #expect(await context.transport.paths.count == 3)
        try await context.transport.complete(2, cards: [Self.entries[1]], cursor: nil)
        await search.value
        try await context.transport.complete(1, cards: [Self.entries[0]], cursor: nil)
        await oldPage.value
        #expect(context.model.availableCards == [Self.entries[1]])
        #expect(!context.model.hasMoreCards)
        #expect(context.model.nextPageError == nil)
    }

    @Test func `A later page failure retains choices and retries only when requested`() async throws {
        let context = try await makeContext()
        let initial = Task { await context.model.load(using: context.cards, collections: context.collections) }
        await context.transport.waitForRequests(1)
        try await context.transport.complete(0, cards: [Self.entries[0]], cursor: "next")
        await initial.value
        try #require(context.model.hasMoreCards)
        let next = Task { await context.model.loadNextPage(using: context.cards) }
        await context.transport.waitForRequests(2)
        await context.transport.fail(1)
        await next.value
        #expect(context.model.availableCards == [Self.entries[0]])
        #expect(context.model.nextPageError == .serverUnavailable)
        await context.model.loadNextPage(using: context.cards)
        #expect(await context.transport.paths.count == 2)
        let retry = Task { await context.model.loadNextPage(retry: true, using: context.cards) }
        await context.transport.waitForRequests(3)
        try await context.transport.complete(2, cards: [Self.entries[1]], cursor: nil)
        await retry.value
        #expect(context.model.availableCards == Self.entries)
        #expect(context.model.nextPageError == nil)
        #expect(!context.model.hasMoreCards)
    }

    @Test func `Repeating cursors stop automatic pagination without duplicating choices`() async throws {
        let context = try await makeContext()
        let initial = Task { await context.model.load(using: context.cards, collections: context.collections) }
        await context.transport.waitForRequests(1)
        try await context.transport.complete(0, cards: [Self.entries[0]], cursor: "next")
        await initial.value
        try #require(context.model.hasMoreCards)
        let next = Task { await context.model.loadNextPage(using: context.cards) }
        await context.transport.waitForRequests(2)
        try await context.transport.complete(1, cards: [Self.entries[0]], cursor: "next")
        await next.value
        #expect(context.model.availableCards == [Self.entries[0]])
        #expect(context.model.nextPageError == .serverUnavailable)
        await context.model.loadNextPage(using: context.cards)
        #expect(await context.transport.paths.count == 2)
    }

    @Test func `Occupied slots reuse the already loaded page card without requesting picker pages`() async throws {
        let context = try await CollectionTestFixtures.selectedContext()
        let card = try #require(context.cards.cards.first)
        var collection = try #require(context.collections.selected)
        collection.pages = [
            .init(id: CardsTestIDs.secondary, slots: [.init(row: 1, column: 1, cardID: card.card.id, quantity: 1)])
        ]
        let transport = BinderPickerTransport()
        let cards = try CSVImportTestClient.makeCollection(transport: transport)
        let model = BinderSlotEditorModel(
            collection: collection,
            position: .init(pageID: CardsTestIDs.secondary, row: 1, column: 1),
            card: card
        )
        await model.load(using: cards, collections: context.collections)
        #expect(await transport.paths.isEmpty)
        #expect(model.selectedCard == card)
        #expect(model.quantity == 1)
    }

    @Test func `Downloaded collections never request editable picker pages`() async throws {
        let context = try await makeContext()
        context.cards.useDownloadedCards(Self.entries)
        await context.model.load(using: context.cards, collections: context.collections)
        #expect(await context.transport.paths.isEmpty)
        #expect(!context.model.canSave)
        #expect(await context.model.save(using: context.cards, collections: context.collections) == false)
    }

    private static let entries: [CardWithPrice] = PreviewTCGCardsClient.sampleCards.map { source in
        let card = Card(
            id: source.id,
            game: source.game,
            name: source.name,
            setName: source.setName,
            cardNumber: source.cardNumber,
            notes: source.notes,
            createdAt: source.createdAt,
            updatedAt: source.updatedAt,
            purchases: source.purchases.map {
                CardPurchase(id: UUID(), condition: $0.condition, quantity: $0.quantity)
            },
            collectionID: nil,
            allocationAdjustments: nil,
            illustrator: source.illustrator
        )
        return CardWithPrice(card: card, price: OwnedCardPrice(cardId: card.id, status: .unavailable))
    }

    private func makeContext() async throws -> Context {
        let transport = BinderPickerTransport()
        let cards = try CSVImportTestClient.makeCollection(transport: transport)
        let loaded = await CollectionTestFixtures.loadedContext()
        let collection = CollectionTestFixtures.binder(columns: 3, rows: 3)
        let model = BinderSlotEditorModel(
            collection: collection,
            position: .init(pageID: CollectionTestFixtures.emptyPage.id, row: 1, column: 1)
        )
        return Context(model: model, cards: cards, collections: loaded.collections, transport: transport)
    }

    private struct Context {
        let model: BinderSlotEditorModel
        let cards: TCGCards
        let collections: TCGCollections
        let transport: BinderPickerTransport
    }
}

private actor BinderPickerTransport: ClientTransport {
    private(set) var paths: [String] = []
    private var pending: [Int: CheckedContinuation<(HTTPResponse, HTTPBody?), Never>] = [:]
    private var waiter: (count: Int, continuation: CheckedContinuation<Void, Never>)?

    func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws -> (
        HTTPResponse, HTTPBody?
    ) {
        let index = paths.count
        paths.append(request.path ?? "")
        return await withCheckedContinuation { continuation in
            pending[index] = continuation
            if let waiter, paths.count >= waiter.count {
                self.waiter = nil
                waiter.continuation.resume()
            }
        }
    }

    func waitForRequests(_ count: Int) async {
        if paths.count >= count { return }
        await withCheckedContinuation { waiter = (count, $0) }
    }

    func complete(_ index: Int, cards: [CardWithPrice], cursor: String?) throws {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(Date.ISO8601FormatStyle(includingFractionalSeconds: true).format(date))
        }
        let body = try encoder.encode(Page(cards: cards, cursor: cursor))
        let continuation = take(index)
        defer { continuation.resume(returning: (HTTPResponse(status: .ok), HTTPBody(body))) }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let value = try decoder.singleValueContainer().decode(String.self)
            return try Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(value)
        }
        _ = try decoder.decode(Components.Schemas.CardsListResponse.self, from: body)
    }

    func fail(_ index: Int) {
        take(index).resume(returning: (HTTPResponse(status: .serviceUnavailable), HTTPBody("{}")))
    }

    private func take(_ index: Int) -> CheckedContinuation<(HTTPResponse, HTTPBody?), Never> {
        guard let continuation = pending.removeValue(forKey: index) else {
            preconditionFailure("A page request must be pending before completion.")
        }
        return continuation
    }

    private struct Row: Encodable {
        let entry: CardWithPrice

        private enum CodingKeys: String, CodingKey {
            case price
        }

        func encode(to encoder: Encoder) throws {
            try entry.card.encode(to: encoder)
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(entry.price, forKey: .price)
        }
    }

    private struct Page: Encodable {
        let cards: [CardWithPrice]
        let cursor: String?

        private enum CodingKeys: String, CodingKey {
            case cards
            case cursor = "next_cursor"
            case sets = "available_set_names"
            case illustrators = "available_illustrators"
        }

        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(cards.map(Row.init), forKey: .cards)
            try container.encode(cursor, forKey: .cursor)
            try container.encode([String](), forKey: .sets)
            try container.encode([String](), forKey: .illustrators)
        }
    }
}
