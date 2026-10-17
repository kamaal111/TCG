import Foundation
import KamaalAuth
import Observation
import SwiftUI
import TCGClient

@MainActor
@Observable
public final class TCGCurrency {
    public private(set) var preferredCurrency: Currency = .fallback
    public private(set) var rates: ExchangeRates?
    public private(set) var isSaving = false
    public private(set) var preferenceLoaded = false
    public private(set) var saveFailed = false
    private let client: TCGCurrencyClient
    private let defaults: UserDefaults?
    private var account: String?
    private var generation = UUID()
    private var preferenceRevision = 0
    private var ratesFetchedOn: Date?
    private var isRefreshing = false

    public init(client: TCGClient = .default(), defaults: UserDefaults? = .standard) {
        self.client = client.currency
        self.defaults = defaults
        if let data = defaults?.data(forKey: Self.rateCacheKey),
            let cached = try? JSONDecoder().decode(ExchangeRates.self, from: data)
        {
            rates = cached
        }
    }

    private struct CachedPreference: Codable {
        let account: String
        let currency: Currency
    }

    private static let preferenceCacheKey = "TCG.currency.preference"

    private func restorePreference(account: String?) {
        guard let account else { return }
        if let previous = self.account, previous != account { clearSession() }
        self.account = account
        guard !preferenceLoaded else { return }
        guard let data = defaults?.data(forKey: Self.preferenceCacheKey) else { return }
        guard let cached = try? JSONDecoder().decode(CachedPreference.self, from: data) else { return }
        guard cached.account == account else { return }
        preferredCurrency = cached.currency
        preferenceLoaded = true
    }

    private func cachePreference() {
        guard let account else { return }
        let cached = CachedPreference(account: account, currency: preferredCurrency)
        if let data = try? JSONEncoder().encode(cached) { defaults?.set(data, forKey: Self.preferenceCacheKey) }
    }

    private static let rateCacheKey = "TCG.currency.rates"

    public func trackSession(_ auth: KamaalAuth) async {
        for await state in auth.sessionStates() {
            guard !Task.isCancelled else { return }
            switch state {
            case .validatingCredentials: break
            case .unauthenticated: clearSession()
            case .authenticated:
                restorePreference(account: auth.session?.email)
                await refresh()
            }
        }
    }

    public func refresh(locale: Locale = .current) async {
        guard !isRefreshing else { return }
        guard !isSaving else { return }
        isRefreshing = true
        let token = generation
        let revision = preferenceRevision
        defer { if token == generation { isRefreshing = false } }
        switch await client.preference() {
        case .success(let preference):
            guard token == generation else { return }
            guard revision == preferenceRevision else { return }
            preferredCurrency = preference.currency
            preferenceLoaded = true
            if preference.isExplicit { cachePreference() }
            if !preference.isExplicit {
                _ = await persist(Currency.initialPreference(locale: locale), onlyIfUnset: true)
            }
        case .failure: break
        }
        guard token == generation else { return }
        if let ratesFetchedOn, Calendar.current.isDateInToday(ratesFetchedOn) { return }
        if case .success(let latest) = await client.latestRates() {
            guard token == generation else { return }
            rates = latest
            ratesFetchedOn = .now
            if let data = try? JSONEncoder().encode(latest) { defaults?.set(data, forKey: Self.rateCacheKey) }
        }
    }

    @discardableResult
    public func save(_ currency: Currency) async -> Bool {
        await persist(currency, onlyIfUnset: false)
    }

    private func persist(_ currency: Currency, onlyIfUnset: Bool) async -> Bool {
        guard !isSaving else { return false }
        let token = generation
        preferenceRevision += 1
        isSaving = true
        saveFailed = false
        defer { if token == generation { isSaving = false } }
        switch await client.update(.init(preferredCurrency: currency, onlyIfUnset: onlyIfUnset ? true : nil)) {
        case .success(let preference):
            guard token == generation else { return false }
            preferredCurrency = preference.currency
            preferenceLoaded = true
            cachePreference()
            return true
        case .failure:
            guard token == generation else { return false }
            saveFailed = true
            return false
        }
    }

    public func clearSession() {
        generation = UUID()
        account = nil
        defaults?.removeObject(forKey: Self.preferenceCacheKey)
        preferredCurrency = .fallback
        preferenceLoaded = false
        isSaving = false
        isRefreshing = false
        saveFailed = false
    }

    public func converted(_ amount: Decimal, from source: Currency) -> Decimal? {
        if source == preferredCurrency { return amount }
        return rates?.convert(amount, from: source, to: preferredCurrency)
    }
}

extension EnvironmentValues {
    @Entry public var tcgCurrency: TCGCurrency? = nil
}
