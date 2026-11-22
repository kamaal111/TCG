import Foundation
import KamaalLogger
import Testing

@testable import TCGSettings

#if os(macOS)
    import AppKit
#elseif os(iOS)
    import UIKit
#endif

@Suite("App logs")
struct TCGAppLogsTests {
    @Test
    func `Structured fields preserve order repeated keys punctuation and JSON values`() async throws {
        let holder = LogHolder(max: 1)
        let logger = KamaalLogger(label: "TCGCards", holder: holder)
        logger.info(
            "example",
            fields: [
                .init("value", "a=b; c=d", privacy: .public),
                .init("value", "second", privacy: .public),
                .init("empty", "", privacy: .public),
                .init("object", object: ["count": 2], privacy: .public),
            ]
        )

        let entry = try #require(TCGAppLog.recent(in: await holder.logs, disclosure: .redacted).first)
        #expect(entry.message == "example")
        #expect(
            Array(entry.fields.dropLast()) == [
                .init(key: nil, value: "example"),
                .init(key: "value", value: "a=b; c=d"),
                .init(key: "value", value: "second"),
                .init(key: "empty", value: ""),
            ]
        )
        let object = try #require(entry.fields.last)
        #expect(object.key == "object")
        #expect(try JSONDecoder().decode([String: Int].self, from: Data(object.value.utf8)) == ["count": 2])
    }

    @Test
    @MainActor
    func `Copy writes only the selected approved value to the platform pasteboard`() async throws {
        let holder = LogHolder(max: 1)
        AppLogFixture.requestFailure(into: holder)
        let entry = try #require(TCGAppLog.recent(in: await holder.logs, disclosure: .redacted).first)
        let status = try #require(entry.fields.first { $0.key == "status" })
        #expect(entry.fields.allSatisfy { $0.key != "request_id" && !$0.value.contains("example-secret") })

        #if os(macOS)
            let pasteboard = NSPasteboard.withUniqueName()
            defer { pasteboard.releaseGlobally() }
            #expect(TCGAppLogDetail.copy(status.value, to: pasteboard))
            #expect(pasteboard.string(forType: .string) == "503")
        #elseif os(iOS)
            let name = UIPasteboard.Name(rawValue: UUID().uuidString)
            let pasteboard = try #require(UIPasteboard(name: name, create: true))
            defer { UIPasteboard.remove(withName: name) }
            #expect(TCGAppLogDetail.copy(status.value, to: pasteboard))
            #expect(pasteboard.string == "503")
        #endif
    }

    @Test
    func `Shows the newest log first and keeps repeated rows individually selectable`() async throws {
        let holder = LogHolder(max: 3)
        AppLogFixture.currencyPreference(into: holder)
        AppLogFixture.requestFailure(into: holder)
        AppLogFixture.requestFailure(into: holder)

        let logs = await holder.logs
        let rows = TCGAppLog.recent(in: logs, disclosure: .redacted)
        #expect(rows.map(\.id) == [2, 1, 0])
        #expect(rows.map(\.source) == ["RequestDiagnosticsMiddleware", "RequestDiagnosticsMiddleware", "TCGCurrency"])
        let first = try #require(rows.first)
        #expect(first.level == .error)
        #expect(first.timestamp == logs.last?.timestamp)
        #expect(first.summaryContext == "cards.list")
        #expect(rows.last?.fields.map(\.value) == ["currency.preference.applied", "initialize"])
    }

    @Test(arguments: ["AuthTokenProvider", "KeychainCredentialsStore", "Unknown"])
    func `Release excludes authentication internals and unreviewed sources`(source: String) {
        let log = HoldedLog(label: source, level: .error, message: "example-secret", timestamp: .distantPast)
        #expect(TCGAppLog.recent(in: [log], disclosure: .redacted).isEmpty)
    }

    @Test(arguments: [
        ("OfflineCollection", "offline.sync.failed", "account"),
        ("URLSessionCardImageLoader", "test event", "url"),
        ("TCGSearch", "test event", "description"),
        ("TCGCardsClientImpl", "test event", "path"),
        ("TCGCurrency", "test event", "rate_date"),
    ])
    func `Release keeps approved fields and Debug can show private fields`(
        source: String,
        message: String,
        privateField: String
    ) async {
        let holder = LogHolder(max: 1)
        let logger = KamaalLogger(label: source, holder: holder)
        logger.error(
            message,
            fields: [
                .init("reason", "failed", privacy: .public),
                .init(privateField, "example-secret"),
            ]
        )
        let logs = await holder.logs

        let release = TCGAppLog.recent(in: logs, disclosure: .redacted)
        #expect(release.first?.fields.map(\.value) == [message, "failed"])
        let debug = TCGAppLog.recent(in: logs, disclosure: .unredacted)
        #expect(debug.first?.fields.map(\.value) == [message, "failed", "example-secret"])
    }

    @Test
    func `Release excludes unreviewed offline messages`() {
        let log = HoldedLog(label: "OfflineCollection", level: .info, message: "raw payload", timestamp: .distantPast)
        #expect(TCGAppLog.recent(in: [log], disclosure: .redacted).isEmpty)
    }

    @Test
    func `Debug shows original unstructured messages from any source`() {
        let message = "An opaque value; token=example-secret; value=a=b"
        let log = HoldedLog(label: "AuthTokenProvider", level: .debug, message: message, timestamp: .distantPast)

        let rows = TCGAppLog.recent(in: [log], disclosure: .unredacted)
        #expect(rows.first?.fields == [.init(key: nil, value: message)])
        #if DEBUG
            #expect(TCGAppLog.Disclosure.appBuild == .unredacted)
        #else
            #expect(TCGAppLog.Disclosure.appBuild == .redacted)
        #endif
    }

    @Test
    func `An empty buffer produces no rows`() {
        #expect(TCGAppLog.recent(in: [], disclosure: .redacted).isEmpty)
    }
}

enum AppLogFixture {
    static func requestFailure(into holder: LogHolder) {
        let logger = KamaalLogger(label: "RequestDiagnosticsMiddleware", holder: holder)
        logger.error(
            "api.request.failed",
            fields: [
                .init("operation", "cards.list", privacy: .public),
                .init("status", object: 503, privacy: .public),
                .init("request_id", "example-secret"),
                .init("duration_ms", object: 45, privacy: .public),
            ]
        )
    }

    static func currencyPreference(into holder: LogHolder) {
        let logger = KamaalLogger(label: "TCGCurrency", holder: holder)
        logger.info(
            "currency.preference.applied",
            fields: [
                .init("source", "initialize", privacy: .public),
                .init("currency", "EUR"),
            ]
        )
    }
}
