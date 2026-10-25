import Foundation

public struct CurrencyPreference: Equatable, Sendable {
    public let currency: Currency
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

public struct CurrencyPreferencePayload: Codable, Equatable, Sendable {
    public let preferredCurrency: Currency

    public init(preferredCurrency: Currency) {
        self.preferredCurrency = preferredCurrency
    }

    enum CodingKeys: String, CodingKey {
        case preferredCurrency = "preferred_currency"
    }
}

public enum CurrencyClientError: Error, Equatable, Sendable {
    case badRequest(validations: [TCGClientValidationIssue])
    case unauthorized
    case unavailable
    case unknown
}
