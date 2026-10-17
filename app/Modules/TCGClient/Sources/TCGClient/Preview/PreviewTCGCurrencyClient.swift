import Foundation

struct PreviewTCGCurrencyClient: TCGCurrencyClient {
    func initialize(_ payload: CurrencyPreferencePayload) async -> Result<CurrencyPreference, CurrencyClientError> {
        .success(.init(currency: payload.preferredCurrency))
    }

    func update(_ payload: CurrencyPreferencePayload) async -> Result<CurrencyPreference, CurrencyClientError> {
        .success(.init(currency: payload.preferredCurrency))
    }

    func latestRates() async -> Result<ExchangeRates, CurrencyClientError> {
        .success(.init(date: "2026-10-16", rates: ["EUR": 1, "USD": 1.25, "JPY": 150]))
    }
}
