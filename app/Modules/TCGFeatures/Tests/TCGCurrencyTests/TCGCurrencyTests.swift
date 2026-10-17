import Foundation
import HTTPTypes
import KamaalAuth
import OpenAPIRuntime
import TCGClient
import Testing

@testable import TCGCurrency

@Suite("Preferred currency")
@MainActor
struct TCGCurrencyTests {
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
        #expect(state.converted(1500, from: .jpy) == 10)
        #expect(await transport.updates == [.eur])
        #expect(await state.save(.gbp))
        await state.refresh(locale: Locale(identifier: "ja_JP"))
        #expect(state.preferredCurrency == .gbp)
        #expect(await transport.updates == [.eur, .gbp])
        #expect(await transport.seedFlags == [true, false])
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
    func `A failed refresh retains the persisted exchange-rate snapshot`() async throws {
        let namespace = "TCGCurrencyTests.\(UUID())"
        let defaults = try #require(UserDefaults(suiteName: namespace))
        defer { defaults.removePersistentDomain(forName: namespace) }
        let transport = PreferenceTransport(explicit: true)
        let first = makeState(transport, defaults: defaults)
        await first.refresh()
        #expect(await first.save(.eur))
        await transport.rejectRates()
        let restored = makeState(transport, defaults: defaults)
        await restored.refresh()
        #expect(restored.preferredCurrency == .eur)
        #expect(restored.converted(1500, from: .jpy) == 10)
        #expect(restored.rates?.date == "2026-10-16")
    }

    private func makeState(_ transport: PreferenceTransport, defaults: UserDefaults? = nil) -> TCGCurrency {
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
        return TCGCurrency(client: client, defaults: defaults)
    }

    @Test
    func `Defaults to supported device region and otherwise USD`() {
        #expect(Currency.initialPreference(locale: Locale(identifier: "nl_NL")) == .eur)
        #expect(Currency.initialPreference(locale: Locale(identifier: "ja_JP")) == .jpy)
        #expect(Currency.initialPreference(locale: Locale(identifier: "ar_AE")) == .fallback)
    }
}

private actor PreferenceTransport: ClientTransport {
    private(set) var updates: [Currency] = []
    private(set) var seedFlags: [Bool] = []
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
        if request.method == .patch {
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
            let payload = try JSONDecoder().decode(UpdateCurrencyPreferencePayload.self, from: data)
            selected = payload.preferredCurrency
            seedFlags.append(payload.onlyIfUnset ?? false)
            updates.append(selected)
        }
        let explicit = initiallyExplicit || !updates.isEmpty
        let json = """
            {"session":{"expires_at":"2030-01-01T00:00:00.000Z","created_at":"2026-10-16T00:00:00.000Z","updated_at":"2026-10-16T00:00:00.000Z"},"user":{"id":"currency-user","name":"User","email":"user@example.com","email_verified":false,"created_at":"2026-10-16T00:00:00.000Z","preferred_currency":"\(selected.rawValue)","has_preferred_currency_preference":\(explicit)}}
            """
        return (HTTPResponse(status: .ok, headerFields: [.contentType: "application/json"]), HTTPBody(json))
    }
}
