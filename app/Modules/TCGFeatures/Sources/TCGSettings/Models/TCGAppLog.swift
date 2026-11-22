import Foundation
import KamaalLogger

struct TCGAppLog: Identifiable {
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

    // Dependency and unreviewed messages can contain raw credentials or account data.
    private static let releaseSources: Set<String> = [
        "RequestDiagnosticsMiddleware", "TCGCurrencyClientImpl", "TCGCurrency", "TCGCollections",
        "TCGCards", "TCGCardsClientImpl", "TCGSearch", "TCGSearchHistoryStore", "URLSessionCardImageLoader",
    ]

    static func recent(in logs: [HoldedLog], disclosure: Disclosure) -> [Self] {
        let newestFirst = logs.enumerated().reversed()
        return newestFirst.compactMap { index, log in
            if disclosure == .redacted, !releaseSources.contains(log.label) { return nil }
            return Self(
                id: index,
                source: log.label,
                level: log.level,
                message: disclosure == .redacted ? redactedMessage(for: log) : log.message,
                timestamp: log.timestamp
            )
        }
    }

    private static func redactedMessage(for log: HoldedLog) -> String {
        switch log.label {
        case "RequestDiagnosticsMiddleware":
            removeField("request_id=", from: log.message)
        case "TCGCurrency":
            redactCurrencyMessage(log.message)
        case "TCGCardsClientImpl":
            if log.message.hasPrefix("event=cards.import.validation; ") {
                prefix(of: log.message, before: "; code=")
            } else {
                prefix(of: log.message, before: "; path=")
            }
        case "TCGSearch":
            prefix(of: log.message, before: "; description=")
        case "URLSessionCardImageLoader":
            redactArtworkMessage(log.message)
        default:
            log.message
        }
    }

    private static func removeField(_ field: String, from message: String) -> String {
        message
            .components(separatedBy: "; ")
            .filter { !$0.hasPrefix(field) }
            .joined(separator: "; ")
    }

    private static func prefix(of message: String, before delimiter: String) -> String {
        guard let delimiter = message.range(of: delimiter) else { return message }
        return String(message[..<delimiter.lowerBound])
    }

    private static func redactArtworkMessage(_ message: String) -> String {
        let withoutURL = prefix(of: message, before: "; url=")
        return prefix(of: withoutURL, before: ": ")
    }

    private static func redactCurrencyMessage(_ message: String) -> String {
        guard let dateField = message.range(of: "; rate_date=") else {
            return removeField("currency=", from: message)
        }
        let prefix = message[..<dateField.upperBound]
        let tail = message[dateField.upperBound...]
        // Only the applied event appends a trusted count after the server or cache date.
        let countField =
            if message.hasPrefix("event=currency.rates.applied; ") {
                tail.range(of: "; result_count=", options: .backwards)
            } else {
                nil as Range<String.Index>?
            }
        let date = tail[..<(countField?.lowerBound ?? tail.endIndex)]
        let safeDate = date.wholeMatch(of: /[0-9]{4}-[0-9]{2}-[0-9]{2}/) == nil ? "none" : date
        if let countField, let count = Int(tail[countField.upperBound...]) {
            return "\(prefix)\(safeDate); result_count=\(count)"
        }
        return "\(prefix)\(safeDate)"
    }
}
