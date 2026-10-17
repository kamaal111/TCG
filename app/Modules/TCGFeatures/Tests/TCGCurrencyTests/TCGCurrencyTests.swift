import Foundation
import HTTPTypes
import KamaalAuth
import KamaalLogger
import OpenAPIRuntime
import TCGClient
import Testing

@testable import TCGCurrency

@Suite("Preferred currency")
@MainActor
struct TCGCurrencyTests {
    @Test
    func `Display identity changes with saved preferences and session resets`() async {
        let state = makeState(PreferenceTransport(explicit: true), holder: LogHolder(max: nil))
        await state.refresh()
        let initial = state.displayIdentity
        #expect(await state.save(.gbp))
        let saved = state.displayIdentity
        #expect(saved != initial)
        #expect(saved.currency == .gbp)
        await state.refresh()
        #expect(state.displayIdentity == saved)
        state.clearSession()
        #expect(state.displayIdentity != initial)
        #expect(state.displayIdentity != saved)
    }

    @Test
    func `Logs applied preferences and retained state after failed saves`() async throws {
        let holder = LogHolder(max: nil)
        let transport = PreferenceTransport(explicit: true)
        let state = makeState(transport, holder: holder)
        await state.refresh()
        #expect(await state.save(.gbp))
        await transport.rejectUpdates()
        #expect(await state.save(.eur) == false)
        let logs = await currencyLogs(holder, containing: "reason=save_failed", minimumCount: 4)
        #expect(
            logs.contains { $0.message.contains("event=currency.preference.applied; source=initialize; currency=USD") }
        )
        #expect(logs.contains { $0.message.contains("event=currency.preference.applied; source=save; currency=GBP") })
        #expect(
            logs.contains { $0.message.contains("event=currency.rates.applied; source=network; rate_date=2026-10-16") }
        )
        #expect(logs.contains { $0.level == .warning && $0.message.contains("reason=save_failed; currency=GBP") })
        #expect(logs.allSatisfy { !$0.message.contains("user@example.com") && !$0.message.contains("authToken") })
        #expect(state.preferredCurrency == .gbp)
    }

    @Test
    func `Logs corrupt caches and rate failure without a fallback snapshot`() async throws {
        let namespace = "TCGCurrencyLogs.\(UUID())"
        let defaults = try #require(UserDefaults(suiteName: namespace))
        defer { defaults.removePersistentDomain(forName: namespace) }
        defaults.set(Data("private-invalid-cache".utf8), forKey: "TCG.currency.rates")
        let holder = LogHolder(max: nil)
        let transport = PreferenceTransport(explicit: true)
        await transport.rejectRates()
        let state = makeState(transport, defaults: defaults, holder: holder)
        await state.refresh()
        let logs = await currencyLogs(holder, containing: "cache_status=missing", minimumCount: 3)
        #expect(
            logs.contains { $0.message.contains("event=currency.cache.rejected; cache=rates; reason=decoding_failed") }
        )
        #expect(
            logs.contains {
                $0.message.contains("event=currency.rates.retained; reason=refresh_failed; cache_status=missing")
            }
        )
        #expect(logs.allSatisfy { !$0.message.contains("private-invalid-cache") })
        #expect(state.rates == nil)
    }

    @Test
    func `Cancelled initialization never logs application success`() async {
        let holder = LogHolder(max: nil)
        let transport = PreferenceTransport(explicit: false)
        let state = makeState(transport, holder: holder)
        await transport.holdUpdates()
        let refresh = Task { await state.refresh(locale: Locale(identifier: "nl_NL")) }
        await transport.waitForUpdate()
        refresh.cancel()
        await transport.releaseUpdate()
        await refresh.value
        let logs = await currencyLogs(holder, containing: "reason=cancelled")
        #expect(
            logs.contains {
                $0.level == .debug && $0.message.contains("event=currency.response.discarded; reason=cancelled")
            }
        )
        #expect(logs.allSatisfy { !$0.message.contains("event=currency.preference.applied") })
        #expect(state.preferenceLoaded == false)
    }
    @Test
    func `Converts using the same daily snapshot and preserves same currency without rates`() throws {
        let rates = ExchangeRates(date: "2026-10-16", rates: ["EUR": 1, "USD": 1.25, "JPY": 150])
        #expect(rates.convert(12.5, from: .usd, to: .eur) == 10)
        #expect(rates.convert(1500, from: .jpy, to: .eur) == 10)
        #expect(rates.convert(3000, from: .jpy, to: .eur) == 20)
        #expect(rates.convert(-12.5, from: .usd, to: .eur) == -10)
        #expect(rates.convert(0, from: .usd, to: .eur) == 0)
        #expect(rates.convert(10, from: .gbp, to: .eur) == nil)
        #expect(ExchangeRates(date: "2026-10-16", rates: [:]).convert(10, from: .eur, to: .eur) == 10)
    }

    @Test
    func `Seeds device currency once and saves an explicit preference`() async throws {
        let transport = PreferenceTransport(explicit: false)
        let state = makeState(transport)
        await state.refresh(locale: Locale(identifier: "nl_NL"))
        #expect(state.preferredCurrency == .eur)
        #expect(state.rates?.convert(1500, from: .jpy, to: state.preferredCurrency) == 10)
        #expect(await transport.updates == [.eur])
        #expect(await state.save(.gbp))
        await state.refresh(locale: Locale(identifier: "ja_JP"))
        #expect(state.preferredCurrency == .gbp)
        #expect(await transport.updates == [.eur, .gbp])
        #expect(await transport.preferenceMethods == [.post, .patch, .post])
    }

    @Test
    func `Failed save retains the prior preference and sign out clears it`() async {
        let transport = PreferenceTransport(explicit: true)
        let state = makeState(transport)
        await state.refresh()
        await transport.rejectUpdates()
        #expect(await state.save(.eur) == false)
        #expect(state.preferredCurrency == .usd)
        #expect(state.saveFailed)
        state.clearSession()
        #expect(state.preferredCurrency == .fallback)
        #expect(state.preferenceLoaded == false)
        #expect(state.saveFailed == false)
    }

    @Test
    func `A late preference save cannot restore a signed-out account`() async {
        let transport = PreferenceTransport(explicit: true)
        let state = makeState(transport)
        await state.refresh()
        #expect(state.preferenceLoaded)
        await transport.holdUpdates()
        let saving = Task { await state.save(.eur) }
        await transport.waitForUpdate()
        state.clearSession()
        await transport.releaseUpdate()
        #expect(await saving.value == false)
        #expect(state.preferredCurrency == .fallback)
        #expect(state.preferenceLoaded == false)
    }

    @Test
    func `A late initialization cannot restore a signed-out account`() async {
        let holder = LogHolder(max: nil)
        let transport = PreferenceTransport(explicit: false)
        let state = makeState(transport, holder: holder)
        await transport.holdUpdates()
        let refreshing = Task { await state.refresh(locale: Locale(identifier: "nl_NL")) }
        await transport.waitForUpdate()
        state.clearSession()
        await transport.releaseUpdate()
        await refreshing.value
        #expect(state.preferredCurrency == .fallback)
        #expect(state.preferenceLoaded == false)
        let logs = await currencyLogs(holder, containing: "reason=session_changed", minimumCount: 2)
        #expect(logs.allSatisfy { !$0.message.contains("event=currency.preference.applied") })
    }

    @Test
    func `A failed refresh retains the persisted exchange-rate snapshot`() async throws {
        let namespace = "TCGCurrencyTests.\(UUID())"
        let defaults = try #require(UserDefaults(suiteName: namespace))
        defer { defaults.removePersistentDomain(forName: namespace) }
        let transport = PreferenceTransport(explicit: true)
        let first = makeState(transport, defaults: defaults)
        await first.refresh()
        #expect(await first.save(.eur))
        await transport.rejectRates()
        let holder = LogHolder(max: nil)
        let restored = makeState(transport, defaults: defaults, holder: holder)
        await restored.refresh()
        #expect(restored.preferredCurrency == .eur)
        #expect(restored.rates?.convert(1500, from: .jpy, to: restored.preferredCurrency) == 10)
        #expect(restored.rates?.date == "2026-10-16")
        let logs = await currencyLogs(holder, containing: "cache_status=available", minimumCount: 3)
        #expect(
            logs.contains { $0.message.contains("event=currency.rates.applied; source=cache; rate_date=2026-10-16") }
        )
        #expect(logs.contains { $0.message.contains("cache_status=available; rate_date=2026-10-16") })
    }

    private func makeState(
        _ transport: PreferenceTransport,
        defaults: UserDefaults? = nil,
        holder: LogHolder = LogHolder(max: nil)
    ) -> TCGCurrency {
        let credentials = Credentials(
            authToken: "auth",
            authTokenExpiryDate: .distantFuture,
            sessionToken: "session",
            sessionUpdateAge: 1800,
            lastSessionUpdate: .now
        )
        let client = TCGClient.default(
            transport: transport,
            credentialsKeychainKey: "currency-tests",
            credentialsStore: InMemoryCredentialsStore(
                seed: try? JSONEncoder().encode(credentials),
                key: "currency-tests"
            )
        )
        return TCGCurrency(
            client: client,
            defaults: defaults,
            logger: KamaalLogger(from: TCGCurrency.self, holder: holder)
        )
    }

    @Test
    func `Defaults to supported device region and otherwise USD`() {
        #expect(Currency.initialPreference(locale: Locale(identifier: "nl_NL")) == .eur)
        #expect(Currency.initialPreference(locale: Locale(identifier: "ja_JP")) == .jpy)
        #expect(Currency.initialPreference(locale: Locale(identifier: "ar_AE")) == .fallback)
    }
}

private func currencyLogs(_ holder: LogHolder, containing marker: String, minimumCount: Int = 1) async -> [HoldedLog] {
    let clock = ContinuousClock()
    let deadline = clock.now.advanced(by: .seconds(2))
    while clock.now < deadline {
        let logs = await holder.logs
        if logs.count >= minimumCount && logs.contains(where: { $0.message.contains(marker) }) { return logs }
        await Task.yield()
    }
    return await holder.logs
}

private actor PreferenceTransport: ClientTransport {
    private(set) var updates: [Currency] = []
    private(set) var preferenceMethods: [HTTPRequest.Method] = []
    private let initiallyExplicit: Bool
    private var selected: Currency = .usd
    private var failRates = false
    func rejectRates() { failRates = true }
    private var failUpdates = false
    private var holdsUpdates = false
    private var updateStarted = false
    private var updateGate: CheckedContinuation<Void, Never>?
    private var updateWaiter: CheckedContinuation<Void, Never>?

    func holdUpdates() { holdsUpdates = true }
    func waitForUpdate() async {
        if updateStarted { return }
        await withCheckedContinuation { updateWaiter = $0 }
    }
    func releaseUpdate() {
        updateGate?.resume()
        updateGate = nil
    }

    init(explicit: Bool) { initiallyExplicit = explicit }
    func rejectUpdates() { failUpdates = true }

    func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws -> (
        HTTPResponse, HTTPBody?
    ) {
        if operationID == "get/app-api/forex/latest" {
            if failRates {
                return (
                    HTTPResponse(status: .serviceUnavailable, headerFields: [.contentType: "application/json"]),
                    HTTPBody(
                        """
                        {"message":"No exchange rates available","code":"EXCHANGE_RATES_UNAVAILABLE"}
                        """
                    )
                )
            }
            return (
                HTTPResponse(status: .ok, headerFields: [.contentType: "application/json"]),
                HTTPBody(
                    """
                    {"base":"EUR","date":"2026-10-16","rates":{"EUR":1,"USD":1.25,"JPY":150}}
                    """
                )
            )
        }
        if request.method == .post || request.method == .patch {
            if holdsUpdates {
                updateStarted = true
                updateWaiter?.resume()
                updateWaiter = nil
                await withCheckedContinuation { updateGate = $0 }
            }
            if failUpdates {
                return (
                    HTTPResponse(status: .unauthorized, headerFields: [.contentType: "application/json"]),
                    HTTPBody(
                        """
                        {"message":"Unauthorized","code":"UNAUTHORIZED"}
                        """
                    )
                )
            }
            let data = try await Data(collecting: #require(body), upTo: 100_000)
            let payload = try JSONDecoder().decode(CurrencyPreferencePayload.self, from: data)
            if request.method == .patch || (!initiallyExplicit && updates.isEmpty) {
                selected = payload.preferredCurrency
                updates.append(selected)
            }
            preferenceMethods.append(request.method)
        }
        let json = """
            {"session":{"expires_at":"2030-01-01T00:00:00.000Z","created_at":"2026-10-16T00:00:00.000Z","updated_at":"2026-10-16T00:00:00.000Z"},"user":{"id":"currency-user","name":"User","email":"user@example.com","email_verified":false,"created_at":"2026-10-16T00:00:00.000Z","preferred_currency":"\(selected.rawValue)"}}
            """
        return (HTTPResponse(status: .ok, headerFields: [.contentType: "application/json"]), HTTPBody(json))
    }
}
