import Testing

@testable import TCGClient
@testable import TCGSets

@MainActor
struct TCGSetsScreenModelTests {
    private let destination = CatalogSetDestination(game: .pokemon, set: .init(id: "me2pt5", name: "Ascended Heroes"))

    @Test
    func `Retries a failed continuation and keeps existing sets`() async {
        let client = SetsModelTestClient(checklistContinuation: .succeed)
        let sets = TCGSets(client: client)
        let model = TCGSetsScreenModel(debounce: .zero)
        model.query = "  Ascended  "
        let request = model.request(game: .pokemon, collectionRevision: 0)

        await model.search(request, using: sets)
        #expect(model.page(for: .all).entries.map(\.id) == ["me2pt5"])
        #expect(model.nextScrollPage(.all, for: request)?.cursor == "more")
        let inProgressPage = model.nextScrollPage(.inProgress, for: request)
        #expect(inProgressPage?.cursor == "progress-more")
        #expect(await client.lastQuery == "Ascended")

        await model.loadMore(.all, for: request, using: sets)
        let failed = model.page(for: .all)
        #expect(failed.failed)
        #expect(failed.nextCursor == "more")
        #expect(model.nextScrollPage(.all, for: request) == nil)
        #expect(failed.entries.map(\.id) == ["me2pt5"])
        #expect(model.nextScrollPage(.inProgress, for: request) == inProgressPage)
        await model.loadMore(.inProgress, for: request, using: sets)
        #expect(model.page(for: .inProgress).entries.map(\.id) == ["me2pt5", "me3"])
        #expect(model.page(for: .all).failed)

        await model.loadMore(.all, for: request, using: sets)
        let loaded = model.page(for: .all)
        #expect(!loaded.canLoadMore)
        #expect(loaded.entries.map(\.id) == ["me2pt5", "me3"])
    }

    @Test
    func `Checklist appends the next page and stops at the end`() async {
        let client = SetsModelTestClient(checklistContinuation: .succeed)
        let sets = TCGSets(client: client)
        let model = SetChecklistScreenModel(destination: destination)
        let request = model.request(collectionRevision: 0)

        await model.search(request, using: sets)
        #expect(model.page.entries.map(\.printedNumber) == ["001"])
        #expect(model.nextScrollPage(for: request)?.cursor == "more")

        await model.loadMore(for: request, using: sets)
        #expect(model.page.entries.map(\.printedNumber) == ["001", "002"])
        #expect(model.nextScrollPage(for: request) == nil)

        await model.loadMore(for: request, using: sets)
        #expect(await client.checklistContinuations == ["more"])
    }

    @Test
    func `Checklist pauses automatic pagination until a failed page is retried`() async {
        let client = SetsModelTestClient(checklistContinuation: .failOnce)
        let sets = TCGSets(client: client)
        let model = SetChecklistScreenModel(destination: destination)
        let request = model.request(collectionRevision: 0)

        await model.search(request, using: sets)
        await model.loadMore(for: request, using: sets)
        #expect(model.page.entries.map(\.printedNumber) == ["001"])
        #expect(model.page.failed)
        #expect(model.nextScrollPage(for: request) == nil)

        await model.loadMore(for: request, using: sets)
        #expect(model.page.entries.map(\.printedNumber) == ["001", "002"])
        #expect(!model.page.failed)
        #expect(await client.checklistContinuations == ["more", "more"])
    }

    @Test
    func `Discards the old checklist page after changing ownership filter`() async {
        let client = SetsModelTestClient(checklistContinuation: .pause)
        let sets = TCGSets(client: client)
        let model = SetChecklistScreenModel(destination: destination)
        let all = model.request(collectionRevision: 0)
        await model.search(all, using: sets)
        let loading = Task { await model.loadMore(for: all, using: sets) }
        await client.waitForChecklistContinuation()

        model.filter = .missing
        #expect(model.nextScrollPage(for: all) == nil)
        await model.search(model.request(collectionRevision: 0), using: sets)
        await client.completeChecklistContinuation()
        await loading.value

        #expect(model.page.entries.map(\.number) == ["3"])
        #expect(model.summary?.progress.collected == 1)
        #expect(!model.page.isLoading)
    }
}

private actor SetsModelTestClient: TCGSetsClient {
    enum ChecklistContinuation {
        case succeed, failOnce, pause
    }

    private var pageAttempts = 0
    private let checklistContinuation: ChecklistContinuation
    private var checklistResponse: CheckedContinuation<Void, Never>?
    private var checklistRequested: CheckedContinuation<Void, Never>?
    private(set) var checklistContinuations: [String] = []
    private(set) var lastQuery: String?

    init(checklistContinuation: ChecklistContinuation) {
        self.checklistContinuation = checklistContinuation
    }

    func list(
        game: ClientCardGame,
        query: String?,
        inProgress: Bool,
        cursor: String?
    ) async -> Result<CatalogSetPage<CatalogSetSummary>, CatalogSetsError> {
        lastQuery = query
        let ascended = summary(id: "me2pt5", name: "Ascended Heroes", collected: 1)
        if inProgress {
            if cursor == nil { return .success(.init(entries: [ascended], nextCursor: "progress-more")) }
            let perfectOrder = summary(id: "me3", name: "Perfect Order", collected: 1)
            return .success(.init(entries: [perfectOrder], nextCursor: nil))
        }
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
        if let cursor {
            checklistContinuations.append(cursor)
            if checklistContinuation == .failOnce && checklistContinuations.count == 1 {
                return .failure(.unavailable)
            }
            if checklistContinuation == .pause {
                await withCheckedContinuation { continuation in
                    checklistResponse = continuation
                    checklistRequested?.resume()
                    checklistRequested = nil
                }
            }
        }
        let number: String
        if !isAll {
            number = "3"
        } else {
            number = cursor == nil ? "1" : "2"
        }
        let card = CatalogSetCard(
            number: number,
            printedNumber: "00\(number)",
            name: "Card",
            imageURL: nil,
            owned: isAll
        )
        return .success(
            .init(
                cards: .init(entries: [card], nextCursor: isAll && cursor == nil ? "more" : nil),
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

    func waitForChecklistContinuation() async {
        guard checklistResponse == nil else { return }
        await withCheckedContinuation { checklistRequested = $0 }
    }

    func completeChecklistContinuation() {
        checklistResponse?.resume()
        checklistResponse = nil
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
