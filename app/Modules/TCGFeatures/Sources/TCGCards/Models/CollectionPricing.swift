import Foundation
import TCGClient

@MainActor
final class CollectionPricing {
    struct Key: Codable, Hashable {
        let cardID: UUID
        let revision: Date
        let currency: Currency?
        let day: Date

        init(row: CardWithPrice, currency: Currency?, day: Date) {
            cardID = row.card.id
            revision = row.card.updatedAt
            self.currency = currency
            self.day = day
        }
    }

    private let client: TCGCardsClient
    private let snapshot: CollectionSnapshotCache
    private let now: () -> Date
    private var pending: [Key: Task<Void, Never>] = [:]
    private var retryAfter: [Key: Date] = [:]
    private var generation = UUID()

    init(client: TCGCardsClient, snapshot: CollectionSnapshotCache, now: @escaping () -> Date) {
        self.client = client
        self.snapshot = snapshot
        self.now = now
    }

    func clear() {
        generation = UUID()
        for batch in pending.values { batch.cancel() }
        pending.removeAll()
        retryAfter.removeAll()
    }

    func needsRefresh(_ rows: [CardWithPrice], currency: Currency?, retry: Bool) -> Bool {
        !eligible(keys(for: rows, currency: currency), retry: retry).isEmpty
    }

    func refresh(_ rows: [CardWithPrice], currency: Currency?, retry: Bool) async -> [CardWithPrice] {
        guard !Task.isCancelled else { return rows }

        let keys = keys(for: rows, currency: currency)
        let token = generation
        let needed = eligible(keys, retry: retry)
        let newKeys = needed.filter { pending[$0] == nil }
        for start in stride(from: 0, to: newKeys.count, by: 100) {
            let batchKeys = Array(newKeys[start..<min(start + 100, newKeys.count)])
            let batch = Task { await fetch(batchKeys, generation: token) }
            for key in batchKeys { pending[key] = batch }
        }

        for key in needed {
            guard !Task.isCancelled else { return rows }

            if let batch = pending[key] { await batch.value }
        }

        guard token == generation, !Task.isCancelled else { return rows }

        let entries = zip(rows, keys)
        return entries.map { row, key in
            guard let update = snapshot.price(for: key, on: key.day) else { return row }

            return CardWithPrice(
                card: row.card.applyingPriceUpdate(update),
                price: update.price,
                imageURL: row.imageURL
            )
        }
    }

    private func eligible(_ keys: [Key], retry: Bool) -> [Key] {
        let instant = now()
        let day = Self.day(for: instant)
        retryAfter = retryAfter.filter { $0.value > instant }
        let unique = Set(keys)
        let eligible = unique.filter { key in
            snapshot.price(for: key, on: day) == nil && (retry || retryAfter[key] == nil)
        }
        return Array(eligible)
    }

    private func keys(for rows: [CardWithPrice], currency: Currency?) -> [Key] {
        let day = Self.day(for: now())
        return rows.map { Key(row: $0, currency: currency ?? $0.card.displayCurrency, day: day) }
    }

    private func fetch(_ keys: [Key], generation token: UUID) async {
        let ids = Array(Set(keys.map(\.cardID))).sorted { $0.uuidString < $1.uuidString }
        let result = await client.prices(ids: ids)
        guard token == generation, !Task.isCancelled else { return }

        let byID = Dictionary(
            ((try? result.get()) ?? []).map { ($0.cardID, $0) },
            uniquingKeysWith: { first, _ in first }
        )
        let completion = now()
        var updates: [Key: OwnedCardPriceUpdate] = [:]
        for key in keys {
            pending.removeValue(forKey: key)
            if let update = byID[key.cardID], update.updatedAt == key.revision,
                key.currency == nil || update.displayCurrency == key.currency,
                Self.day(for: completion) == key.day,
                Self.isDailyResult(update.price.status)
            {
                updates[key] = update
                retryAfter.removeValue(forKey: key)
            } else {
                retryAfter[key] = completion.addingTimeInterval(60)
            }
        }
        snapshot.savePrices(updates, on: Self.day(for: completion))
    }

    private static func isDailyResult(_ status: OwnedCardPriceStatus) -> Bool {
        switch status {
        case .priced, .noPrice, .noMatch: true
        case .pending, .unavailable: false
        }
    }

    private static func day(for instant: Date) -> Date {
        let day = floor(instant.timeIntervalSince1970 / 86_400)
        return Date(timeIntervalSince1970: day * 86_400)
    }
}
