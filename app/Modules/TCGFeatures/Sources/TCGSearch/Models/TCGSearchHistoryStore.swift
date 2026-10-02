import Foundation
import KamaalLogger
import Observation
import TCGClient

struct TCGSearchHistoryEntry: Codable, Equatable, Identifiable {
    let id: UUID
    let game: ClientCardGame
    let query: String
    let lastUsedAt: Date
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
            let archive = try JSONDecoder().decode(Archive.self, from: data)
            guard archive.version == 1 else { return }
            entries = archive.entries.sorted { $0.lastUsedAt > $1.lastUsedAt }
            var retained: [TCGSearchHistoryEntry] = []
            for entry in entries {
                let query = entry.query.trimmingCharacters(in: .whitespacesAndNewlines)
                guard query.count >= 2 else { continue }
                guard retained.filter({ $0.game == entry.game }).count < 100 else { continue }
                guard !retained.contains(where: { $0.game == entry.game && Self.matches($0.query, query) }) else {
                    continue
                }
                guard !retained.contains(where: { $0.id == entry.id }) else { continue }
                retained.append(.init(id: entry.id, game: entry.game, query: query, lastUsedAt: entry.lastUsedAt))
            }
            entries = retained
        } catch {
            Self.logger.warning("Could not load local search history; starting with an empty history")
        }
    }

    func entries(for game: ClientCardGame) -> [TCGSearchHistoryEntry] {
        entries.filter { $0.game == game }
    }

    func suggestions(for query: String, game: ClientCardGame) -> [TCGSearchHistoryEntry] {
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return [] }
        return Array(
            entries(for: game).filter {
                !Self.matches($0.query, query) && $0.query.localizedCaseInsensitiveContains(query)
            }.prefix(5)
        )
    }

    func record(query: String, game: ClientCardGame) {
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard query.count >= 2 else { return }
        let existing = entries.first { $0.game == game && Self.matches($0.query, query) }
        entries.removeAll { $0.game == game && Self.matches($0.query, query) }
        entries.insert(.init(id: existing?.id ?? UUID(), game: game, query: query, lastUsedAt: now()), at: 0)
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
            let data = try JSONEncoder().encode(Archive(version: 1, entries: entries))
            defaults.set(data, forKey: Self.storageKey)
        } catch {
            Self.logger.warning("Could not persist local search history")
        }
    }

    private static func matches(_ lhs: String, _ rhs: String) -> Bool {
        lhs.caseInsensitiveCompare(rhs) == .orderedSame
    }

    private struct Archive: Codable {
        let version: Int
        let entries: [TCGSearchHistoryEntry]
    }
}
