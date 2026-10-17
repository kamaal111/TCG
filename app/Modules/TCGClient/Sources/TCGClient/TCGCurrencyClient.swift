import Foundation

public protocol TCGCurrencyClient: Sendable {
    func preference() async -> Result<CurrencyPreference, CurrencyClientError>
    func update(_ payload: UpdateCurrencyPreferencePayload) async -> Result<CurrencyPreference, CurrencyClientError>
    func latestRates() async -> Result<ExchangeRates, CurrencyClientError>
}

struct TCGCurrencyClientImpl: TCGCurrencyClient {
    private let client: Client

    init(client: Client) { self.client = client }

    func preference() async -> Result<CurrencyPreference, CurrencyClientError> {
        do {
            switch try await client.getAppApiAuthSession() {
            case .ok(let response):
                let payload = try response.body.json
                return .success(
                    Self.preference(
                        currency: payload.value2.user.preferredCurrency,
                        isExplicit: payload.value2.user.hasPreferredCurrencyPreference
                    )
                )
            case .unauthorized: return .failure(.unauthorized)
            case .internalServerError, .undocumented: return .failure(.unknown)
            }
        } catch { return .failure(.unknown) }
    }

    func update(_ payload: UpdateCurrencyPreferencePayload) async -> Result<
        CurrencyPreference, CurrencyClientError
    > {
        do {
            switch try await client.patchAppApiAuthPreferences(
                body: .json(
                    .init(
                        preferredCurrency: PricedCardMapper.generatedCurrency(payload.preferredCurrency),
                        onlyIfUnset: payload.onlyIfUnset
                    )
                )
            ) {
            case .ok(let response):
                let payload = try response.body.json
                return .success(
                    Self.preference(
                        currency: payload.value2.user.preferredCurrency,
                        isExplicit: payload.value2.user.hasPreferredCurrencyPreference
                    )
                )
            case .badRequest(let response):
                return .failure(
                    .badRequest(validations: TCGClientValidationErrorParser.parseIssues(from: try? response.body.json))
                )
            case .unauthorized: return .failure(.unauthorized)
            case .undocumented: return .failure(.unknown)
            }
        } catch { return .failure(.unknown) }
    }

    func latestRates() async -> Result<ExchangeRates, CurrencyClientError> {
        do {
            switch try await client.getAppApiForexLatest() {
            case .ok(let response):
                let snapshot = try response.body.json
                let rates = snapshot.rates.additionalProperties
                guard rates["EUR"] == 1 else { return .failure(.unknown) }
                guard rates.values.allSatisfy({ $0.isFinite && $0 > 0 }) else { return .failure(.unknown) }
                return .success(.init(date: snapshot.date, rates: rates.mapValues { Decimal($0) }))
            case .unauthorized: return .failure(.unauthorized)
            case .serviceUnavailable: return .failure(.unavailable)
            case .undocumented: return .failure(.unknown)
            }
        } catch { return .failure(.unknown) }
    }

    private static func preference(currency: Components.Schemas.Currency, isExplicit: Bool)
        -> CurrencyPreference
    {
        .init(currency: PricedCardMapper.makeCurrency(currency), isExplicit: isExplicit)
    }
}
