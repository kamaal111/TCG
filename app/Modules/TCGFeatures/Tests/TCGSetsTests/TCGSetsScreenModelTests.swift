import Testing

@testable import TCGClient
@testable import TCGSets

@MainActor
struct TCGSetsScreenModelTests {
    @Test
    func `Retries a failed continuation and keeps existing sets`() async {
        let client = SetsModelTestClient()
        let sets = TCGSets(client: client)
        let model = TCGSetsScreenModel(debounce: .zero)
        model.query = "  Ascended  "
        let request = model.request(game: .pokemon, collectionRevision: 0)

        await model.search(request, using: sets)
        #expect(model.page(for: .all).entries.map(\.id) == ["me2pt5"])
        #expect(await client.lastQuery == "Ascended")

        await model.loadMore(.all, for: request, using: sets)
        let failed = model.page(for: .all)
        #expect(failed.failed)
        #expect(failed.nextCursor == "more")
        #expect(failed.entries.map(\.id) == ["me2pt5"])

        await model.loadMore(.all, for: request, using: sets)
        let loaded = model.page(for: .all)
        #expect(!loaded.canLoadMore)
        #expect(loaded.entries.map(\.id) == ["me2pt5", "me3"])
    }

    @Test
    func `Discards the old checklist page after changing ownership filter`() async {
        let client = SetsModelTestClient()
        let sets = TCGSets(client: client)
        let destination = CatalogSetDestination(game: .pokemon, set: .init(id: "me2pt5", name: "Ascended Heroes"))
        let model = SetChecklistScreenModel(destination: destination)
        let all = model.request(collectionRevision: 0)
        let loading = Task { await model.search(all, using: sets) }
        await client.waitForAll()

        model.filter = .missing
        await model.search(model.request(collectionRevision: 0), using: sets)
        await client.completeAll()
        await loading.value

        #expect(model.page.entries.map(\.number) == ["2"])
        #expect(model.summary?.progress.collected == 1)
        #expect(!model.page.isLoading)
    }
}

private actor SetsModelTestClient: TCGSetsClient {
    private var pageAttempts = 0
    private var allResponse: CheckedContinuation<Void, Never>?
    private var allRequested: CheckedContinuation<Void, Never>?
    private(set) var lastQuery: String?

    func list(
        game: ClientCardGame,
        query: String?,
        inProgress: Bool,
        cursor: String?
    ) async -> Result<CatalogSetPage<CatalogSetSummary>, CatalogSetsError> {
        lastQuery = query
        if inProgress { return .success(.init(entries: [], nextCursor: nil)) }
        let ascended = summary(id: "me2pt5", name: "Ascended Heroes", collected: 1)
        guard cursor != nil else { return .success(.init(entries: [ascended], nextCursor: "more")) }

        pageAttempts += 1
        if pageAttempts == 1 { return .failure(.unavailable) }
        let perfectOrder = summary(id: "me3", name: "Perfect Order", collected: 0)
        return .success(.init(entries: [ascended, perfectOrder], nextCursor: nil))
    }

    func checklist(
        game: ClientCardGame,
        setID: String,
        filter: CatalogChecklistFilter,
        cursor: String?
    ) async -> Result<CatalogChecklistPage, CatalogSetsError> {
        let isAll = filter == .all
        if isAll {
            await withCheckedContinuation { continuation in
                allResponse = continuation
                allRequested?.resume()
                allRequested = nil
            }
        }
        let number = isAll ? "1" : "2"
        let card = CatalogSetCard(number: number, printedNumber: number, name: "Card", imageURL: nil, owned: isAll)
        return .success(
            .init(
                cards: .init(entries: [card], nextCursor: nil),
                set: summary(id: setID, name: "Ascended Heroes", collected: isAll ? 0 : 1)
            )
        )
    }

    func detail(
        game: ClientCardGame,
        setID: String,
        number: String
    ) async -> Result<[PricedCard], CatalogSetsError> {
        .failure(.unavailable)
    }

    func waitForAll() async {
        guard allResponse == nil else { return }
        await withCheckedContinuation { allRequested = $0 }
    }

    func completeAll() {
        allResponse?.resume()
        allResponse = nil
    }

    private func summary(id: String, name: String, collected: Int) -> CatalogSetSummary {
        .init(
            set: .init(id: id, name: name),
            logo: nil,
            symbol: nil,
            language: "en",
            progress: .init(collected: collected, total: 10)
        )
    }
}
