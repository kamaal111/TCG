import Foundation
import Testing

@testable import TCGClient
@testable import TCGSearch

@Suite("TCGSearch History Store Tests")
@MainActor
struct TCGSearchHistoryStoreTests {
    @Test
    func `Migrates version one history and persists separate illustrator searches in version two`() throws {
        let namespace = "TCGSearchHistoryTests.\(UUID())"
        let defaults = try #require(UserDefaults(suiteName: namespace))
        defer { defaults.removePersistentDomain(forName: namespace) }
        let data = Data(
            """
            {
                "version": 1,
                "entries": [{
                    "id": "00000000-0000-4000-8000-000000000001",
                    "game": "pokemon",
                    "query": "Mitsuhiro Arita",
                    "lastUsedAt": 0
                }]
            }
            """.utf8
        )
        defaults.set(data, forKey: "TCGSearch.history.v1")
        let store = TCGSearchHistoryStore(defaults: defaults)
        let entry = try #require(store.entries.first)
        #expect(entry.mode == .card)
        #expect(entry.id == UUID(uuidString: "00000000-0000-4000-8000-000000000001"))
        store.record(query: "Mitsuhiro Arita", game: .pokemon, mode: .illustrator)
        #expect(store.entries.count == 2)
        let savedData = try #require(defaults.data(forKey: "TCGSearch.history.v1"))
        let savedArchive = try #require(JSONSerialization.jsonObject(with: savedData) as? [String: Any])
        #expect(savedArchive["version"] as? Int == 2)
        #expect(TCGSearchHistoryStore(defaults: defaults).entries == store.entries)
        #expect(
            store.suggestions(for: "Arita", game: .pokemon, mode: .illustrator)
                .map(\.mode) == [.illustrator]
        )
        #expect(
            store.suggestions(for: "Arita", game: .pokemon, mode: .card)
                .map(\.mode) == [.card]
        )
    }

    @Test
    func `Trims queries and moves case insensitive duplicates to the front`() throws {
        let store = TCGSearchHistoryStore(now: { Date(timeIntervalSince1970: 100) })
        store.record(query: "  Giratina  ", game: .pokemon, mode: .card)
        let original = try #require(store.entries.first)
        store.record(query: "Pikachu", game: .pokemon, mode: .card)
        store.record(query: "giratina", game: .pokemon, mode: .card)

        #expect(store.entries.map(\.query) == ["giratina", "Pikachu"])
        #expect(store.entries.first?.id == original.id)
        #expect(store.entries.first?.lastUsedAt == Date(timeIntervalSince1970: 100))
    }

    @Test
    func `Keeps games separate and retains the latest 100 searches per game`() {
        let store = TCGSearchHistoryStore()
        store.record(query: "Nami", game: .onePiece, mode: .card)
        for index in 0..<101 { store.record(query: "Card \(index)", game: .pokemon, mode: .card) }

        #expect(store.entries(for: .pokemon).count == 100)
        #expect(store.entries(for: .pokemon).first?.query == "Card 100")
        #expect(store.entries(for: .pokemon).last?.query == "Card 1")
        #expect(store.entries(for: .onePiece).map(\.query) == ["Nami"])
    }

    @Test
    func `Repeating a query updates its timestamp without combining games`() {
        var date = Date(timeIntervalSince1970: 100)
        let store = TCGSearchHistoryStore(now: { date })
        store.record(query: "Pikachu", game: .pokemon, mode: .card)
        store.record(query: "Pikachu", game: .onePiece, mode: .card)
        date = Date(timeIntervalSince1970: 200)
        store.record(query: "PIKACHU", game: .pokemon, mode: .card)

        #expect(store.entries.count == 2)
        #expect(store.entries(for: .pokemon).first?.query == "PIKACHU")
        #expect(store.entries(for: .pokemon).first?.lastUsedAt == date)
        #expect(store.entries(for: .onePiece).first?.lastUsedAt == Date(timeIntervalSince1970: 100))
    }

    @Test
    func `Suggestions match case insensitively exclude exact matches and return at most five`() {
        let store = TCGSearchHistoryStore()
        for index in 0..<7 { store.record(query: "Pikachu \(index)", game: .pokemon, mode: .card) }
        store.record(query: "PIK", game: .pokemon, mode: .card)
        store.record(query: "Pikachu", game: .onePiece, mode: .card)

        #expect(
            store.suggestions(for: " pik ", game: .pokemon, mode: .card)
                .map(\.query) == [
                    "Pikachu 6", "Pikachu 5", "Pikachu 4", "Pikachu 3", "Pikachu 2",
                ]
        )
        #expect(store.suggestions(for: "  ", game: .pokemon, mode: .card).isEmpty)
    }

    @Test
    func `Ignores empty and single character queries`() {
        let store = TCGSearchHistoryStore()
        store.record(query: "  ", game: .pokemon, mode: .card)
        store.record(query: " x ", game: .pokemon, mode: .card)
        #expect(store.entries.isEmpty)
    }

    @Test
    func `Persists entries deletion and clearing across store recreation`() throws {
        let namespace = "TCGSearchHistoryTests.\(UUID())"
        let defaults = try #require(UserDefaults(suiteName: namespace))
        defer { defaults.removePersistentDomain(forName: namespace) }
        let store = TCGSearchHistoryStore(defaults: defaults)
        store.record(query: "Giratina", game: .pokemon, mode: .card)
        store.record(query: "Pikachu", game: .pokemon, mode: .card)
        store.record(query: "Nami", game: .onePiece, mode: .card)
        let reloaded = TCGSearchHistoryStore(defaults: defaults)
        #expect(reloaded.entries == store.entries)

        reloaded.remove(try #require(reloaded.entries(for: .pokemon).first))
        #expect(TCGSearchHistoryStore(defaults: defaults).entries(for: .pokemon).map(\.query) == ["Giratina"])
        reloaded.clear(game: .pokemon)
        #expect(TCGSearchHistoryStore(defaults: defaults).entries.map(\.query) == ["Nami"])
    }

    @Test
    func `Recovers from invalid stored history and can save new entries`() throws {
        let namespace = "TCGSearchHistoryTests.\(UUID())"
        let defaults = try #require(UserDefaults(suiteName: namespace))
        defer { defaults.removePersistentDomain(forName: namespace) }
        defaults.set(Data("invalid archive".utf8), forKey: "TCGSearch.history.v1")
        let store = TCGSearchHistoryStore(defaults: defaults)
        #expect(store.entries.isEmpty)
        store.record(query: "Giratina", game: .pokemon, mode: .card)
        #expect(TCGSearchHistoryStore(defaults: defaults).entries.map(\.query) == ["Giratina"])
    }
}
