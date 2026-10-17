import Foundation

public struct CurrencyPreference: Equatable, Sendable {
    public let currency: Currency
    public let isExplicit: Bool
}

public struct ExchangeRates: Codable, Equatable, Sendable {
    public let date: String
    public let rates: [String: Decimal]

    public init(date: String, rates: [String: Decimal]) {
        self.date = date
        self.rates = rates
    }

    public func convert(_ amount: Decimal, from source: Currency, to target: Currency) -> Decimal? {
        guard !amount.isNaN else { return nil }
        if source == target { return amount }
        guard let sourceRate = rates[source.rawValue], sourceRate > 0 else { return nil }
        guard let targetRate = rates[target.rawValue], targetRate > 0 else { return nil }
        let result = amount * targetRate / sourceRate
        return result.isNaN ? nil : result
    }
}

public struct UpdateCurrencyPreferencePayload: Codable, Equatable, Sendable {
    public let preferredCurrency: Currency
    public let onlyIfUnset: Bool?
    public init(preferredCurrency: Currency, onlyIfUnset: Bool? = nil) {
        self.preferredCurrency = preferredCurrency
        self.onlyIfUnset = onlyIfUnset
    }
    enum CodingKeys: String, CodingKey {
        case preferredCurrency = "preferred_currency"
        case onlyIfUnset = "only_if_unset"
    }
}

public enum CurrencyClientError: Error, Equatable, Sendable {
    case badRequest(validations: [TCGClientValidationIssue])
    case unauthorized
    case unavailable
    case unknown
}
