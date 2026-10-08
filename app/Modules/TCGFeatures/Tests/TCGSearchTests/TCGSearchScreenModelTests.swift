import Foundation
import HTTPTypes
import KamaalAuth
import OpenAPIRuntime
import Testing

@testable import TCGClient
@testable import TCGSearch

@Suite("TCGSearch Screen Model Tests")
@MainActor
struct TCGSearchScreenModelTests {
    @Test
    func `Multiple sets filter returned cards locally and all sets restores unknown sets`() async {
        let transport = HistoryPricingTransport()
        await transport.setOutcome(.sets, for: 1)
        let feature = makeFeature(transport: transport)
        let model = TCGSearchScreenModel(preferences: nil)
        model.query = "Giratina"
        await model.performSearch(using: feature)
        let results = feature.results
        let history = feature.history.entries

        #expect(model.availableSetNames(using: feature) == ["Crown Zenith", "Lost Origin"])
        #expect(model.filteredResults(using: feature).count == 4)
        model.setNames = ["Crown Zenith"]
        #expect(model.filteredResults(using: feature).map(\.id) == ["zenith", "zenith-2"])
        #expect(model.availableSetNames(using: feature) == ["Crown Zenith", "Lost Origin"])
        model.setNames.insert("Lost Origin")
        #expect(model.filteredResults(using: feature).map(\.id) == ["zenith", "origin", "zenith-2"])
        model.setNames = []
        #expect(model.filteredResults(using: feature) == results)
        #expect(feature.results == results)
        #expect(feature.history.entries == history)
        #expect(await transport.requestCount == 1)
    }

    @Test
    func `Effective query game and language changes immediately reset selected sets`() async {
        let feature = TCGSearch(client: .preview(pricingOutcome: .success), history: TCGSearchHistoryStore())
        let model = TCGSearchScreenModel(preferences: nil, debounce: .seconds(60))
        model.query = "Giratina"
        await model.performSearch(using: feature)
        model.setNames = ["Crown Zenith"]
        model.updateQuery("Pikachu", using: feature)
        #expect(model.setNames.isEmpty)
        model.setNames = ["Base Set"]
        model.updateQuery("", using: feature)
        #expect(model.setNames.isEmpty)
        model.query = "Giratina"
        model.setNames = ["Crown Zenith"]
        model.updateLanguages([.japanese], using: feature)
        #expect(model.setNames.isEmpty)
        model.setNames = ["Crown Zenith"]
        model.updateGame(.onePiece, using: feature)
        #expect(model.setNames.isEmpty)
        model.finishEditing(using: feature)
    }

    @Test
    func `Unchanged inputs refreshing and returning preserve selected sets`() async {
        let feature = TCGSearch(client: .preview(pricingOutcome: .success), history: TCGSearchHistoryStore())
        let model = TCGSearchScreenModel(preferences: nil)
        model.query = "Giratina"
        await model.performSearch(using: feature)
        model.setNames = ["Crown Zenith"]
        model.updateQuery(" Giratina ", using: feature)
        model.updateGame(.pokemon, using: feature)
        model.updateLanguages([.english, .japanese], using: feature)
        #expect(model.setNames == ["Crown Zenith"])
        await model.performSearch(using: feature)
        #expect(model.setNames == ["Crown Zenith"])
        model.finishEditing(using: feature)
        model.resumeSearchIfNeeded(using: feature)
        #expect(model.setNames == ["Crown Zenith"])
        #expect(model.filteredResults(using: feature) == feature.results)
    }

    @Test
    func `History selection resets sets only when effective query or game changes`() async throws {
        let history = TCGSearchHistoryStore()
        history.record(query: "Giratina", game: .pokemon)
        let same = try #require(history.entries.first)
        history.record(query: "Pikachu", game: .pokemon)
        let different = try #require(history.entries.first)
        history.record(query: "Pikachu", game: .onePiece)
        let otherGame = try #require(history.entries.first)
        let feature = TCGSearch(client: .preview(pricingOutcome: .success), history: history)
        let model = TCGSearchScreenModel(preferences: nil)
        model.query = " Giratina "
        model.setNames = ["Crown Zenith"]
        await model.selectHistory(same, using: feature)
        #expect(model.setNames == ["Crown Zenith"])
        await model.selectHistory(different, using: feature)
        #expect(model.setNames.isEmpty)
        model.setNames = ["Base Set"]
        await model.selectHistory(otherGame, using: feature)
        #expect(model.setNames.isEmpty)
        #expect(model.game == .onePiece)
    }

    @Test
    func `A selected set missing after refresh remains available and can be cleared`() async {
        let transport = HistoryPricingTransport()
        await transport.setOutcome(.sets, for: 1)
        let feature = makeFeature(transport: transport)
        let model = TCGSearchScreenModel(preferences: nil)
        model.query = "Giratina"
        await model.performSearch(using: feature)
        model.setNames = ["Crown Zenith"]
        await model.performSearch(using: feature)

        #expect(model.filteredResults(using: feature).isEmpty)
        #expect(model.availableSetNames(using: feature) == ["Crown Zenith"])
        #expect(feature.results.count == 1)
        model.setNames = []
        #expect(model.filteredResults(using: feature) == feature.results)
    }

    @Test
    func `Unchanged effective inputs retain cards and the pending history candidate`() async {
        let transport = HistoryPricingTransport(suspended: true)
        let feature = makeFeature(transport: transport)
        let model = TCGSearchScreenModel(preferences: nil, debounce: .zero)
        model.updateQuery("Giratina", using: feature)
        await transport.waitUntilStarted()
        model.updateQuery("  Giratina  ", using: feature)
        #expect(feature.isSearching)
        await transport.resume()
        await waitForResults(feature)
        let cards = feature.results

        model.updateQuery("Giratina", using: feature)
        model.updateGame(.pokemon, using: feature)
        model.updateLanguages([.english, .japanese], using: feature)

        #expect(feature.results == cards)
        #expect(feature.hasSearched)
        #expect(await transport.requestCount == 1)
        #expect(model.languages == [.english, .japanese])
        model.finishEditing(using: feature)
        #expect(feature.history.entries.map(\.query) == ["Giratina"])
    }

    @Test
    func `Refreshing the same search retains cards until their replacement arrives`() async {
        let transport = HistoryPricingTransport(suspended: true)
        let feature = makeFeature(transport: transport)
        let model = TCGSearchScreenModel(preferences: nil)
        model.query = "Giratina"
        await completeSearch(model: model, feature: feature, transport: transport)
        let cards = feature.results
        let identity = feature.completedSearch
        await transport.setOutcome(.updated, for: 2)
        let refresh = Task { await model.performSearch(using: feature) }
        await transport.waitUntilStarted(count: 2)

        #expect(feature.isSearching)
        #expect(feature.results == cards)
        #expect(feature.completedSearch == identity)
        await transport.resume(count: 2)
        await refresh.value
        #expect(!feature.isSearching)
        #expect(feature.results.count == 1)
        #expect(feature.results != cards)
        #expect(feature.completedSearch == identity)
        #expect(feature.history.entries.count == 1)
    }

    @Test
    func `An empty refresh clears retained cards after the response arrives`() async {
        let transport = HistoryPricingTransport(suspended: true)
        let feature = makeFeature(transport: transport)
        let model = TCGSearchScreenModel(preferences: nil)
        model.query = "Giratina"
        await completeSearch(model: model, feature: feature, transport: transport)
        let entries = feature.history.entries
        await transport.setOutcome(.empty, for: 2)
        let refresh = Task { await model.performSearch(using: feature) }
        await transport.waitUntilStarted(count: 2)
        #expect(!feature.results.isEmpty)
        await transport.resume(count: 2)
        await refresh.value

        #expect(feature.results.isEmpty)
        #expect(feature.hasSearched)
        #expect(feature.history.entries == entries)
    }

    @Test
    func `A failed refresh retains matching cards without updating history`() async {
        let transport = HistoryPricingTransport(suspended: true)
        let feature = makeFeature(transport: transport)
        let model = TCGSearchScreenModel(preferences: nil)
        model.query = "Giratina"
        await completeSearch(model: model, feature: feature, transport: transport)
        let cards = feature.results
        let entries = feature.history.entries
        await transport.setOutcome(.unavailable, for: 2)
        let refresh = Task { await model.performSearch(using: feature) }
        await transport.waitUntilStarted(count: 2)
        #expect(feature.results == cards)
        await transport.resume(count: 2)
        await refresh.value

        #expect(feature.results == cards)
        #expect(feature.hasSearched)
        #expect(model.toast != nil)
        #expect(feature.history.entries == entries)
    }

    @Test
    func `Changed query game and language inputs clear cards immediately`() async {
        let feature = TCGSearch(client: .preview(pricingOutcome: .success), history: TCGSearchHistoryStore())
        let model = TCGSearchScreenModel(preferences: nil, debounce: .seconds(60))
        model.query = "Giratina"
        await model.performSearch(using: feature)
        model.updateQuery("Pikachu", using: feature)
        #expect(feature.results.isEmpty)
        #expect(!feature.hasSearched)
        await model.performSearch(using: feature)
        model.updateLanguages([.japanese], using: feature)
        #expect(feature.results.isEmpty)
        #expect(!feature.hasSearched)
        model.languages = [.english]
        await model.performSearch(using: feature)
        model.updateGame(.onePiece, using: feature)
        #expect(feature.results.isEmpty)
        #expect(!feature.hasSearched)
        model.finishEditing(using: feature)
    }

    private func completeSearch(
        model: TCGSearchScreenModel,
        feature: TCGSearch,
        transport: HistoryPricingTransport
    ) async {
        let task = Task { await model.performSearch(using: feature) }
        await transport.waitUntilStarted()
        await transport.resume()
        await task.value
        #expect(!feature.results.isEmpty)
    }

    @Test
    func `Reusing history retains the current language filter`() async throws {
        let history = TCGSearchHistoryStore()
        history.record(query: "Giratina", game: .pokemon)
        let entry = try #require(history.entries.first)
        let feature = TCGSearch(client: .preview(pricingOutcome: .success), history: history)
        let model = TCGSearchScreenModel(preferences: nil)
        model.languages = [.japanese]

        await model.selectHistory(entry, using: feature)

        #expect(model.languages == [.japanese])
        #expect(feature.hasSearched)
        #expect(feature.results.isEmpty)
        #expect(history.entries == [entry])

        model.updateLanguages([.english], using: feature)
        await model.performSearch(using: feature)
        #expect(feature.results == [PreviewTCGPricingClient.samplePricedCards[1]])
        #expect(history.entries.count == 1)
    }

    @Test
    func `Restores separate raw language selections across launches and game changes`() throws {
        let suiteName = "TCGSearchTests.\(UUID().uuidString)"
        let preferences = try #require(UserDefaults(suiteName: suiteName))
        defer { preferences.removePersistentDomain(forName: suiteName) }
        let model = TCGSearchScreenModel(preferences: preferences)
        model.languages = [.english, .japanese]
        model.game = .onePiece
        #expect(model.languages.isEmpty)
        model.languages = [.english]
        model.game = .pokemon
        #expect(model.languages == [.english, .japanese])

        let restored = TCGSearchScreenModel(preferences: preferences)
        #expect(restored.languages == [.english, .japanese])
        restored.game = .onePiece
        #expect(restored.languages == [.english])
    }

    @Test(arguments: [["invalid"], ["ja", "invalid"]])
    func `Invalid stored selections default to all languages`(codes: [String]) throws {
        let suiteName = "TCGSearchTests.\(UUID().uuidString)"
        let preferences = try #require(UserDefaults(suiteName: suiteName))
        defer { preferences.removePersistentDomain(forName: suiteName) }
        preferences.set(codes, forKey: "TCGSearch.languages.pokemon")
        let model = TCGSearchScreenModel(preferences: preferences)

        #expect(model.languages.isEmpty)
    }

    @Test
    func `Unsupported stored One Piece languages default to all languages`() throws {
        let suiteName = "TCGSearchTests.\(UUID().uuidString)"
        let preferences = try #require(UserDefaults(suiteName: suiteName))
        defer { preferences.removePersistentDomain(forName: suiteName) }
        preferences.set(["ja"], forKey: "TCGSearch.languages.one_piece")
        let model = TCGSearchScreenModel(preferences: preferences)
        model.game = .onePiece

        #expect(model.languages.isEmpty)
    }

    @Test
    func `Submitting forwards the current language filter`() async {
        let feature = TCGSearch(client: .preview(pricingOutcome: .success), history: TCGSearchHistoryStore())
        let model = TCGSearchScreenModel(preferences: nil)
        model.query = "Giratina"
        model.languages = [.japanese]
        await model.performSearch(using: feature)

        #expect(feature.hasSearched)
        #expect(feature.results.isEmpty)
        model.languages = [.english]
        await model.performSearch(using: feature)
        #expect(feature.results == [PreviewTCGPricingClient.samplePricedCards[1]])
    }

    @Test
    func `Short queries clear results even with a language filter`() async throws {
        let feature = TCGSearch(client: .preview(pricingOutcome: .success), history: TCGSearchHistoryStore())
        try await feature.search(game: .pokemon, query: "Giratina").get()
        let model = TCGSearchScreenModel(preferences: nil)
        model.query = "x"
        model.languages = [.japanese]
        model.scheduleSearch(using: feature)

        #expect(!feature.hasSearched)
        #expect(feature.results.isEmpty)
    }

    @Test
    func `Explicit submission saves a trimmed query only after matching cards arrive`() async {
        let feature = TCGSearch(client: .preview(pricingOutcome: .success), history: TCGSearchHistoryStore())
        let model = TCGSearchScreenModel(preferences: nil)
        model.query = "  Giratina  "
        await model.performSearch(using: feature)

        #expect(feature.history.entries.map(\.query) == ["Giratina"])
        #expect(!feature.results.isEmpty)
        model.finishEditing(using: feature)
        #expect(feature.history.entries.count == 1)
    }

    @Test
    func `Empty results errors and short terms never enter history`() async {
        let empty = TCGSearch(client: .preview(pricingOutcome: .noResults), history: TCGSearchHistoryStore())
        let failure = TCGSearch(client: .preview(pricingOutcome: .serverUnavailable), history: TCGSearchHistoryStore())
        let model = TCGSearchScreenModel(preferences: nil)
        model.query = "Missing card"
        await model.performSearch(using: empty)
        model.finishEditing(using: empty)
        await model.performSearch(using: failure)
        model.finishEditing(using: failure)
        model.query = " x "
        await model.performSearch(using: empty)

        #expect(empty.history.entries.isEmpty)
        #expect(failure.history.entries.isEmpty)
        #expect(model.toast != nil)
    }

    @Test
    func `Automatic results save only the final query when clearing the field`() async {
        let feature = TCGSearch(client: .preview(pricingOutcome: .success), history: TCGSearchHistoryStore())
        let model = TCGSearchScreenModel(preferences: nil, debounce: .zero)
        model.updateQuery("Gira", using: feature)
        await waitForResults(feature)
        #expect(feature.history.entries.isEmpty)
        model.updateQuery("Giratina", using: feature)
        await waitForResults(feature)
        model.updateQuery("", using: feature)

        #expect(feature.history.entries.map(\.query) == ["Giratina"])
        #expect(feature.results.isEmpty)
    }

    @Test
    func `Editing invalidates a previous matching query when the final query has no results`() async {
        let history = TCGSearchHistoryStore()
        let matches = TCGSearch(client: .preview(pricingOutcome: .success), history: history)
        let empty = TCGSearch(client: .preview(pricingOutcome: .noResults), history: history)
        let model = TCGSearchScreenModel(preferences: nil, debounce: .zero)
        model.updateQuery("Giratina", using: matches)
        await waitForResults(matches)
        model.updateQuery("Missing", using: empty)
        await waitForResults(empty)
        model.finishEditing(using: empty)

        #expect(history.entries.isEmpty)
    }

    @Test
    func `Changing games records the old game and leaving records the new game`() async {
        let feature = TCGSearch(client: .preview(pricingOutcome: .success), history: TCGSearchHistoryStore())
        let model = TCGSearchScreenModel(preferences: nil, debounce: .zero)
        model.updateQuery("Giratina", using: feature)
        await waitForResults(feature)
        model.updateGame(.onePiece, using: feature)
        model.updateQuery("Nami", using: feature)
        await waitForResults(feature)
        model.finishEditing(using: feature)

        #expect(feature.history.entries(for: .pokemon).map(\.query) == ["Giratina"])
        #expect(feature.history.entries(for: .onePiece).map(\.query) == ["Nami"])
    }

    @Test
    func `Clearing history discards a pending candidate so leaving does not restore it`() async {
        let feature = TCGSearch(client: .preview(pricingOutcome: .success), history: TCGSearchHistoryStore())
        let model = TCGSearchScreenModel(preferences: nil, debounce: .zero)
        model.updateQuery("Giratina", using: feature)
        await waitForResults(feature)
        model.clearHistory(using: feature)
        model.finishEditing(using: feature)

        #expect(feature.history.entries.isEmpty)
    }

    @Test
    func `Selecting history fills the query dismisses focus and requests fresh results once`() async throws {
        let transport = HistoryPricingTransport(suspended: true)
        let feature = makeFeature(transport: transport)
        feature.history.record(query: "Giratina", game: .pokemon)
        let entry = try #require(feature.history.entries.first)
        let model = TCGSearchScreenModel(preferences: nil, debounce: .seconds(30))
        model.isSearchFocused = true
        let selection = Task { await model.selectHistory(entry, using: feature) }
        await transport.waitUntilStarted()
        model.resumeSearchIfNeeded(using: feature)
        await transport.resume()
        await selection.value

        #expect(model.query == "Giratina")
        #expect(model.game == .pokemon)
        #expect(!model.isSearchFocused)
        #expect(await transport.requestCount == 1)
        #expect(feature.results.count == 1)
        #expect(feature.history.entries.count == 1)
    }

    @Test
    func `Leaving while a response is in flight prevents it from populating results or history`() async {
        let transport = HistoryPricingTransport(suspended: true)
        let feature = makeFeature(transport: transport)
        let model = TCGSearchScreenModel(preferences: nil)
        model.query = "Giratina"
        let task = Task { await model.performSearch(using: feature) }
        await transport.waitUntilStarted()
        model.finishEditing(using: feature)
        await transport.resume()
        await task.value

        #expect(feature.results.isEmpty)
        #expect(feature.history.entries.isEmpty)
        #expect(!feature.isSearching)
    }

    @Test
    func `A superseded response cannot replace or record the newer query`() async {
        let transport = HistoryPricingTransport(suspended: true)
        let feature = makeFeature(transport: transport)
        let model = TCGSearchScreenModel(preferences: nil)
        model.query = "Old query"
        let first = Task { await model.performSearch(using: feature) }
        await transport.waitUntilStarted()
        model.query = "New query"
        let second = Task { await model.performSearch(using: feature) }
        await transport.waitUntilStarted(count: 2)
        await transport.resume(count: 2)
        await second.value
        await transport.resume()
        await first.value

        #expect(feature.history.entries.map(\.query) == ["New query"])
        #expect(feature.results.count == 1)
        #expect(model.toast == nil)
    }

    @Test
    func `A cancelled request never records a successful response`() async {
        let transport = HistoryPricingTransport(suspended: true)
        let feature = makeFeature(transport: transport)
        let model = TCGSearchScreenModel(preferences: nil)
        model.query = "Giratina"
        let task = Task { await model.performSearch(using: feature) }
        await transport.waitUntilStarted()
        task.cancel()
        await transport.resume()
        await task.value

        #expect(feature.history.entries.isEmpty)
        #expect(feature.results.isEmpty)
        #expect(!feature.isSearching)
    }

    @Test
    func `Returning to search resumes an unfinished query`() async {
        let feature = TCGSearch(client: .preview(pricingOutcome: .success), history: TCGSearchHistoryStore())
        let model = TCGSearchScreenModel(preferences: nil, debounce: .zero)
        model.updateQuery("Giratina", using: feature)
        model.finishEditing(using: feature)
        model.resumeSearchIfNeeded(using: feature)
        await waitForResults(feature)
        model.finishEditing(using: feature)

        #expect(feature.history.entries.map(\.query) == ["Giratina"])
        #expect(feature.results.count == 1)
    }

    @Test
    func `Removing a different history entry preserves the final matching query`() async throws {
        let feature = TCGSearch(client: .preview(pricingOutcome: .success), history: TCGSearchHistoryStore())
        feature.history.record(query: "Pikachu", game: .pokemon)
        let entry = try #require(feature.history.entries.first)
        let model = TCGSearchScreenModel(preferences: nil, debounce: .zero)
        model.updateQuery("Giratina", using: feature)
        await waitForResults(feature)
        model.removeHistory(entry, using: feature)
        model.finishEditing(using: feature)

        #expect(feature.history.entries.map(\.query) == ["Giratina"])
    }

    private func waitForResults(_ feature: TCGSearch) async {
        let deadline = ContinuousClock.now + .seconds(3)
        while !feature.hasSearched && ContinuousClock.now < deadline { await Task.yield() }
        #expect(feature.hasSearched)
    }

    private func makeFeature(transport: HistoryPricingTransport) -> TCGSearch {
        TCGSearch(
            client: .default(
                transport: transport,
                credentialsKeychainKey: "history-test-credentials",
                credentialsStore: InMemoryCredentialsStore()
            ),
            history: TCGSearchHistoryStore()
        )
    }
}

actor HistoryPricingTransport: ClientTransport {
    enum Outcome { case matches, updated, empty, unavailable, sets }

    private var outcomes: [Int: Outcome] = [:]

    func setOutcome(_ outcome: Outcome, for request: Int) { outcomes[request] = outcome }

    private(set) var requestCount = 0
    private let suspended: Bool
    private var continuations: [Int: CheckedContinuation<Void, Never>] = [:]
    private var started: [Int: CheckedContinuation<Void, Never>] = [:]

    init(suspended: Bool = false) { self.suspended = suspended }

    func waitUntilStarted(count: Int = 1) async {
        if requestCount >= count { return }
        await withCheckedContinuation { started[count] = $0 }
    }

    func resume(count: Int = 1) {
        continuations.removeValue(forKey: count)?.resume()
    }

    func send(
        _: HTTPRequest,
        body _: HTTPBody?,
        baseURL _: URL,
        operationID _: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        requestCount += 1
        let request = requestCount
        if suspended {
            await withCheckedContinuation {
                continuations[request] = $0
                started.removeValue(forKey: request)?.resume()
            }
        }
        let outcome = outcomes[request] ?? .matches
        if outcome == .unavailable { return (HTTPResponse(status: .serviceUnavailable), HTTPBody("{}")) }
        if outcome == .empty { return (HTTPResponse(status: .ok), HTTPBody("{\"matches\": []}")) }
        if outcome == .sets {
            let cards: [(String, String?)] = [
                ("zenith", "Crown Zenith"), ("origin", "Lost Origin"), ("zenith-2", "Crown Zenith"), ("unknown", nil),
            ]
            let matches = cards.map { id, setName in
                var card: [String: Any] = [
                    "id": id, "game": "pokemon", "name": "Giratina", "card_number": "GG69",
                    "headline": ["amount": 10, "currency": "USD", "metric": "lowest_near_mint"],
                    "market": ["condition": "near_mint", "currency": "USD", "low": 10, "market": 10],
                    "priced_on": "2026-10-02T00:00:00.000Z", "fetched_at": "2026-10-02T12:00:00.000Z",
                ]
                card["set_name"] = setName
                return card
            }
            let data = try JSONSerialization.data(withJSONObject: ["matches": matches])
            return (HTTPResponse(status: .ok), HTTPBody(data))
        }
        let amount = outcome == .updated ? 20 : 10
        let body = """
            {
              "matches": [{
                "id": "giratina", "game": "pokemon", "name": "Giratina", "card_number": "GG69",
                "rarity": "Rare", "headline": {"amount": \(amount), "currency": "USD", "metric": "lowest_near_mint"},
                "market": {"condition": "near_mint", "currency": "USD", "low": 10, "market": 10},
                "priced_on": "2026-10-02T00:00:00.000Z", "fetched_at": "2026-10-02T12:00:00.000Z"
              }]
            }
            """
        return (HTTPResponse(status: .ok), HTTPBody(body))
    }
}
