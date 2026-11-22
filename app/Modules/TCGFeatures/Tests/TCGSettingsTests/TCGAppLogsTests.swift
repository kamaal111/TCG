import Foundation
import KamaalLogger
import Testing

@testable import TCGSettings

@Suite("App logs")
struct TCGAppLogsTests {
    @Test
    func `Shows the newest log first and keeps repeated rows individually selectable`() throws {
        let timestamp = Date(timeIntervalSince1970: 0)
        let earlier = HoldedLog(
            label: "TCGCurrency",
            level: .info,
            message: "event=currency.preference.applied; source=initialize; currency=EUR",
            timestamp: timestamp
        )
        let failure = HoldedLog(
            label: "RequestDiagnosticsMiddleware",
            level: .error,
            message:
                "event=api.request.failed; operation=cards.list; status=503; request_id=example-secret; duration_ms=15",
            timestamp: timestamp.addingTimeInterval(1)
        )

        let rows = TCGAppLog.recent(in: [earlier, failure, failure], disclosure: .redacted)

        #expect(rows.map(\.id) == [2, 1, 0])
        #expect(rows.map(\.source) == ["RequestDiagnosticsMiddleware", "RequestDiagnosticsMiddleware", "TCGCurrency"])
        let first = try #require(rows.first)
        #expect(first.level == .error)
        #expect(first.timestamp == failure.timestamp)
        #expect(first.message == "event=api.request.failed; operation=cards.list; status=503; duration_ms=15")
        #expect(rows.last?.message == "event=currency.preference.applied; source=initialize")
    }

    @Test(arguments: ["AuthTokenProvider", "KeychainCredentialsStore", "Unknown"])
    func `Excludes authentication internals and unreviewed sources`(source: String) {
        let log = HoldedLog(
            label: source,
            level: .error,
            message: "token=example-secret",
            timestamp: Date(timeIntervalSince1970: 0)
        )
        #expect(TCGAppLog.recent(in: [log], disclosure: .redacted).isEmpty)
    }

    @Test(arguments: [
        (
            "URLSessionCardImageLoader",
            "Card image load failed; reason=network; attempts=2; url=https://private.example/image?token=example-secret; description='private-error'; error='private-error'",
            "Card image load failed; reason=network; attempts=2"
        ),
        (
            "URLSessionCardImageLoader",
            "Could not save downloaded card artwork: /private/binder.jpg",
            "Could not save downloaded card artwork"
        ),
        (
            "TCGSearch",
            "Card pricing search failed; reason=unknown; status=500; game=pokemon; queryLength=7; description='private-error'; error='private-error'",
            "Card pricing search failed; reason=unknown; status=500; game=pokemon; queryLength=7"
        ),
        (
            "TCGCardsClientImpl",
            "event=cards.import.validation; attempt_id=123; code=private-code; path=private-path; message=example-secret",
            "event=cards.import.validation; attempt_id=123"
        ),
        (
            "TCGCardsClientImpl",
            "event=cards.import.failed; attempt_id=123; stage=response_decoding; http_status=200; cause=DecodingError; path=example-secret",
            "event=cards.import.failed; attempt_id=123; stage=response_decoding; http_status=200; cause=DecodingError"
        ),
        (
            "TCGCurrency",
            "event=currency.rates.applied; source=network; rate_date=2026-10-16; result_count=3",
            "event=currency.rates.applied; source=network; rate_date=2026-10-16; result_count=3"
        ),
        (
            "TCGCurrency",
            "event=currency.rates.applied; source=network; rate_date=2026-10-16; result_count=99; token=example-secret; result_count=3",
            "event=currency.rates.applied; source=network; rate_date=none; result_count=3"
        ),
        (
            "TCGCurrency",
            "event=currency.rates.retained; reason=refresh_failed; cache_status=available; rate_date=2026-10-16; result_count=99",
            "event=currency.rates.retained; reason=refresh_failed; cache_status=available; rate_date=none"
        ),
    ])
    func `Release redaction preserves the events and safe fields`(source: String, message: String, expected: String) {
        let log = HoldedLog(
            label: source,
            level: .error,
            message: message,
            timestamp: Date(timeIntervalSince1970: 0)
        )

        let rows = TCGAppLog.recent(in: [log], disclosure: .redacted)

        #expect(rows.map(\.message) == [expected])
        #expect(rows.map(\.source) == [source])
    }

    @Test
    func `Debug keeps original messages and all sources`() {
        let timestamp = Date(timeIntervalSince1970: 0)
        let artwork = HoldedLog(
            label: "URLSessionCardImageLoader",
            level: .error,
            message: "Card image load failed; reason=decode; url=https://private.example/image?token=example-secret",
            timestamp: timestamp
        )
        let auth = HoldedLog(
            label: "AuthTokenProvider",
            level: .debug,
            message: "synthetic auth detail",
            timestamp: timestamp
        )
        let input = [artwork, auth]
        let unredacted = TCGAppLog.recent(in: input, disclosure: .unredacted)

        #expect(unredacted.map(\.source) == [auth.label, artwork.label])
        #expect(unredacted.map(\.message) == [auth.message, artwork.message])
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
