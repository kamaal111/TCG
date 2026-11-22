import Foundation
import KamaalAuth
import KamaalLogger
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
    private let logger: KamaalLogger
    private var account: String?
    private var generation = UUID()
    private var preferenceRevision = 0
    private var ratesFetchedOn: Date?
    private var isRefreshing = false

    public struct DisplayIdentity: Hashable, Sendable {
        fileprivate let session: UUID
        public let currency: Currency
    }

    public var displayIdentity: DisplayIdentity {
        DisplayIdentity(session: generation, currency: preferredCurrency)
    }

    public convenience init(client: TCGClient, defaults: UserDefaults?) {
        self.init(client: client, defaults: defaults, logger: KamaalLogger(from: TCGCurrency.self))
    }

    init(client: TCGClient, defaults: UserDefaults?, logger: KamaalLogger) {
        self.client = client.currency
        self.defaults = defaults
        self.logger = logger
        if let data = defaults?.data(forKey: Self.rateCacheKey) {
            do {
                rates = try JSONDecoder().decode(ExchangeRates.self, from: data)
                logRates(source: "cache")
            } catch {
                logger.warning(
                    "currency.cache.rejected",
                    fields: [
                        .init("cache", "rates", privacy: .public),
                        .init("reason", "decoding_failed", privacy: .public),
                    ]
                )
            }
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
        do {
            let cached = try JSONDecoder().decode(CachedPreference.self, from: data)
            guard cached.account == account else {
                logger.debug(
                    "currency.cache.skipped",
                    fields: [
                        .init("cache", "preference", privacy: .public),
                        .init("reason", "account_changed", privacy: .public),
                    ]
                )
                return
            }
            preferredCurrency = cached.currency
            preferenceLoaded = true
            logPreference(source: "cache")
        } catch {
            logger.warning(
                "currency.cache.rejected",
                fields: [
                    .init("cache", "preference", privacy: .public),
                    .init("reason", "decoding_failed", privacy: .public),
                ]
            )
        }
    }

    private func cachePreference() {
        guard let account else { return }
        let cached = CachedPreference(account: account, currency: preferredCurrency)
        storeCache(cached, key: Self.preferenceCacheKey, kind: "preference")
    }

    private func storeCache(_ value: some Encodable, key: String, kind: String) {
        do {
            let data = try JSONEncoder().encode(value)
            defaults?.set(data, forKey: key)
        } catch {
            logger.warning(
                "currency.cache.write_failed",
                fields: [
                    .init("cache", kind, privacy: .public),
                    .init("reason", "encoding_failed", privacy: .public),
                ]
            )
        }
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
                await refresh(locale: .current)
            }
        }
    }

    public func refresh(locale: Locale) async {
        guard !isRefreshing else {
            logger.debug(
                "currency.refresh.skipped",
                fields: [
                    .init("reason", "in_flight", privacy: .public)
                ]
            )
            return
        }
        guard !isSaving else {
            logger.debug(
                "currency.refresh.skipped",
                fields: [
                    .init("reason", "saving", privacy: .public)
                ]
            )
            return
        }
        isRefreshing = true
        let token = generation
        let revision = preferenceRevision
        defer { if token == generation { isRefreshing = false } }
        switch await client.initialize(.init(preferredCurrency: Currency.initialPreference(locale: locale))) {
        case .success(let preference):
            guard isCurrent(token) else { return }
            guard revision == preferenceRevision else {
                logger.debug(
                    "currency.response.discarded",
                    fields: [
                        .init("reason", "preference_changed", privacy: .public)
                    ]
                )
                return
            }
            preferredCurrency = preference.currency
            preferenceLoaded = true
            cachePreference()
            logPreference(source: "initialize")
        case .failure:
            guard isCurrent(token) else { return }
            if revision == preferenceRevision {
                logger.warning(
                    "currency.preference.retained",
                    fields: [
                        .init("reason", "initialization_failed", privacy: .public),
                        .init("currency", preferredCurrency.rawValue),
                        .init("preference_loaded", object: preferenceLoaded, privacy: .public),
                    ]
                )
            } else {
                logger.debug(
                    "currency.response.discarded",
                    fields: [
                        .init("reason", "preference_changed", privacy: .public)
                    ]
                )
            }
        }
        guard isCurrent(token) else { return }
        if let ratesFetchedOn, Calendar.current.isDateInToday(ratesFetchedOn) {
            logger.debug(
                "currency.rates.refresh_skipped",
                fields: [
                    .init("reason", "already_fetched_today", privacy: .public)
                ]
            )
            return
        }
        switch await client.latestRates() {
        case .success(let latest):
            guard isCurrent(token) else { return }
            rates = latest
            ratesFetchedOn = .now
            logRates(source: "network")
            storeCache(latest, key: Self.rateCacheKey, kind: "rates")
        case .failure:
            guard isCurrent(token) else { return }
            logger.warning(
                "currency.rates.retained",
                fields: [
                    .init("reason", "refresh_failed", privacy: .public),
                    .init("cache_status", rates == nil ? "missing" : "available", privacy: .public),
                    rateDateField(rates?.date ?? "none"),
                ]
            )
        }
    }

    @discardableResult
    public func save(_ currency: Currency) async -> Bool {
        guard !isSaving else {
            logger.debug(
                "currency.save.skipped",
                fields: [
                    .init("reason", "in_flight", privacy: .public)
                ]
            )
            return false
        }
        let token = generation
        preferenceRevision += 1
        isSaving = true
        saveFailed = false
        defer { if token == generation { isSaving = false } }
        switch await client.update(.init(preferredCurrency: currency)) {
        case .success(let preference):
            guard isCurrent(token) else { return false }
            preferredCurrency = preference.currency
            preferenceLoaded = true
            cachePreference()
            logPreference(source: "save")
            return true
        case .failure:
            guard isCurrent(token) else { return false }
            saveFailed = true
            logger.warning(
                "currency.preference.retained",
                fields: [
                    .init("reason", "save_failed", privacy: .public),
                    .init("currency", preferredCurrency.rawValue),
                ]
            )
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
        logger.info(
            "currency.session.cleared",
            fields: [
                .init("currency", preferredCurrency.rawValue)
            ]
        )
    }

    private func isCurrent(_ token: UUID) -> Bool {
        guard !Task.isCancelled else {
            logger.debug(
                "currency.response.discarded",
                fields: [
                    .init("reason", "cancelled", privacy: .public)
                ]
            )
            return false
        }
        guard token == generation else {
            logger.debug(
                "currency.response.discarded",
                fields: [
                    .init("reason", "session_changed", privacy: .public)
                ]
            )
            return false
        }
        return true
    }

    private func logPreference(source: String) {
        logger.info(
            "currency.preference.applied",
            fields: [
                .init("source", source, privacy: .public),
                .init("currency", preferredCurrency.rawValue),
            ]
        )
    }

    private func logRates(source: String) {
        guard let rates else { return }
        logger.info(
            "currency.rates.applied",
            fields: [
                .init("source", source, privacy: .public),
                rateDateField(rates.date),
                .init("result_count", object: rates.rates.count, privacy: .public),
            ]
        )
    }

    private func rateDateField(_ date: String) -> LogField {
        let isPublic = date == "none" || date.wholeMatch(of: /[0-9]{4}-[0-9]{2}-[0-9]{2}/) != nil
        return .init("rate_date", date, privacy: isPublic ? .public : .private)
    }

}

extension EnvironmentValues {
    @Entry public var tcgCurrency: TCGCurrency? = nil
}
