import Foundation
import KamaalLogger
import Observation
import TCGClient

struct TCGSearchHistoryEntry: Codable, Equatable, Identifiable {
    let id: UUID
    let game: ClientCardGame
    let query: String
    let lastUsedAt: Date
    let mode: ClientCardSearchMode

    init(id: UUID, game: ClientCardGame, query: String, lastUsedAt: Date, mode: ClientCardSearchMode) {
        self.id = id
        self.game = game
        self.query = query
        self.lastUsedAt = lastUsedAt
        self.mode = game == .pokemon ? mode : .card
    }
}

@MainActor
@Observable
final class TCGSearchHistoryStore {
    private(set) var entries: [TCGSearchHistoryEntry] = []

    @ObservationIgnored private let defaults: UserDefaults?
    @ObservationIgnored private let now: () -> Date
    private static let storageKey = "TCGSearch.history.v1"
    private static let logger = KamaalLogger(from: TCGSearchHistoryStore.self)

    init(defaults: UserDefaults? = nil, now: @escaping () -> Date = Date.init) {
        self.defaults = defaults
        self.now = now
        guard let data = defaults?.data(forKey: Self.storageKey) else { return }
        do {
            let decoder = JSONDecoder()
            let version = try decoder.decode(ArchiveVersion.self, from: data).version
            let storedEntries: [TCGSearchHistoryEntry]
            switch version {
            case 1:
                let archive = try decoder.decode(ArchiveV1.self, from: data)
                storedEntries = archive.entries.map {
                    .init(id: $0.id, game: $0.game, query: $0.query, lastUsedAt: $0.lastUsedAt, mode: .card)
                }
            case 2:
                storedEntries = try decoder.decode(ArchiveV2.self, from: data).entries
            default: return
            }
            entries = storedEntries.sorted { $0.lastUsedAt > $1.lastUsedAt }
            var retained: [TCGSearchHistoryEntry] = []
            for entry in entries {
                let query = entry.query.trimmingCharacters(in: .whitespacesAndNewlines)
                guard query.count >= 2 else { continue }
                guard retained.filter({ $0.game == entry.game }).count < 100 else { continue }
                guard
                    !retained.contains(where: {
                        $0.game == entry.game && $0.mode == entry.mode && Self.matches($0.query, query)
                    })
                else {
                    continue
                }
                guard !retained.contains(where: { $0.id == entry.id }) else { continue }
                retained.append(
                    .init(id: entry.id, game: entry.game, query: query, lastUsedAt: entry.lastUsedAt, mode: entry.mode)
                )
            }
            entries = retained
        } catch {
            Self.logger.warning("Could not load local search history; starting with an empty history")
        }
    }

    func entries(for game: ClientCardGame) -> [TCGSearchHistoryEntry] {
        entries.filter { $0.game == game }
    }

    func suggestions(for query: String, game: ClientCardGame, mode: ClientCardSearchMode)
        -> [TCGSearchHistoryEntry]
    {
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return [] }
        return Array(
            entries(for: game)
                .filter {
                    $0.mode == mode && !Self.matches($0.query, query)
                        && $0.query.localizedCaseInsensitiveContains(query)
                }
                .prefix(5)
        )
    }

    func record(query: String, game: ClientCardGame, mode: ClientCardSearchMode) {
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard query.count >= 2 else { return }
        let existing = entries.first { $0.game == game && $0.mode == mode && Self.matches($0.query, query) }
        entries.removeAll { $0.game == game && $0.mode == mode && Self.matches($0.query, query) }
        entries.insert(
            .init(id: existing?.id ?? UUID(), game: game, query: query, lastUsedAt: now(), mode: mode),
            at: 0
        )
        let retainedIDs = Set(entries(for: game).prefix(100).map(\.id))
        entries.removeAll { $0.game == game && !retainedIDs.contains($0.id) }
        persist()
    }

    func remove(_ entry: TCGSearchHistoryEntry) {
        entries.removeAll { $0.id == entry.id }
        persist()
    }

    func clear(game: ClientCardGame) {
        entries.removeAll { $0.game == game }
        persist()
    }

    private func persist() {
        guard let defaults else { return }
        do {
            let data = try JSONEncoder().encode(ArchiveV2(version: 2, entries: entries))
            defaults.set(data, forKey: Self.storageKey)
        } catch {
            Self.logger.warning("Could not persist local search history")
        }
    }

    private static func matches(_ lhs: String, _ rhs: String) -> Bool {
        lhs.caseInsensitiveCompare(rhs) == .orderedSame
    }

    private struct ArchiveV2: Codable {
        let version: Int
        let entries: [TCGSearchHistoryEntry]
    }

    private struct ArchiveVersion: Decodable {
        let version: Int
    }

    private struct ArchiveV1: Decodable {
        let entries: [Entry]

        struct Entry: Decodable {
            let id: UUID
            let game: ClientCardGame
            let query: String
            let lastUsedAt: Date
        }
    }
}
