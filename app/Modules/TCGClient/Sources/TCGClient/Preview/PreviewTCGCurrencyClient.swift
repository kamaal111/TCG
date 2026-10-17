import Foundation

struct PreviewTCGCurrencyClient: TCGCurrencyClient {
    func preference() async -> Result<CurrencyPreference, CurrencyClientError> {
        .success(.init(currency: .fallback, isExplicit: true))
    }

    func update(_ payload: UpdateCurrencyPreferencePayload) async -> Result<CurrencyPreference, CurrencyClientError> {
        .success(.init(currency: payload.preferredCurrency, isExplicit: true))
    }

    func latestRates() async -> Result<ExchangeRates, CurrencyClientError> {
        .success(.init(date: "2026-10-16", rates: ["EUR": 1, "USD": 1.25, "JPY": 150]))
    }
}
