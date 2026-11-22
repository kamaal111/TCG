import Foundation
import KamaalLogger

struct TCGAppLog: Identifiable {
    struct Field: Equatable {
        let key: String?
        let value: String
    }

    enum Disclosure: Equatable {
        case redacted
        case unredacted

        static var appBuild: Self {
            #if DEBUG
                .unredacted
            #else
                .redacted
            #endif
        }
    }

    let id: Int
    let source: String
    let level: LogLevels
    let message: String
    let timestamp: Date

    let fields: [Field]

    var summaryContext: String? {
        fields.first { $0.key == "operation" || $0.key == "source" }?.value
    }

    // Dependency and unreviewed messages can contain raw credentials or account data.
    private static let releaseSources: Set<String> = [
        "RequestDiagnosticsMiddleware", "TCGCurrencyClientImpl", "TCGCurrency", "TCGCollections",
        "TCGCards", "TCGCardsClientImpl", "TCGSearch", "TCGSearchHistoryStore", "URLSessionCardImageLoader",
        "OfflineCollection",
    ]

    private static let offlineEvents: Set<String> = [
        "offline.sync.started", "offline.sync.completed", "offline.sync.failed",
    ]

    private static func isReleaseVisible(_ log: HoldedLog) -> Bool {
        guard releaseSources.contains(log.label) else { return false }
        return log.label != "OfflineCollection" || offlineEvents.contains(log.message)
    }

    static func recent(in logs: [HoldedLog], disclosure: Disclosure) -> [Self] {
        let newestFirst = logs.enumerated().reversed()
        return newestFirst.compactMap { index, log in
            let includesPrivate = disclosure == .unredacted
            guard includesPrivate || isReleaseVisible(log) else { return nil }
            let visible = log.fields(includingPrivate: includesPrivate)
            let fields = visible.map { Field(key: $0.name, value: $0.value.displayText) }
            return Self(
                id: index,
                source: log.label,
                level: log.level,
                message: log.message,
                timestamp: log.timestamp,
                fields: [Field(key: nil, value: log.message)] + fields
            )
        }
    }
}
