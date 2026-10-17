import Foundation
import KamaalLogger
import OpenAPIRuntime

public protocol TCGCurrencyClient: Sendable {
    func initialize(_ payload: CurrencyPreferencePayload) async -> Result<CurrencyPreference, CurrencyClientError>
    func update(_ payload: CurrencyPreferencePayload) async -> Result<CurrencyPreference, CurrencyClientError>
    func latestRates() async -> Result<ExchangeRates, CurrencyClientError>
}

struct TCGCurrencyClientImpl: TCGCurrencyClient {
    private let client: Client
    private let logger: KamaalLogger

    init(client: Client, logger: KamaalLogger = KamaalLogger(from: TCGCurrencyClientImpl.self)) {
        self.client = client
        self.logger = logger
    }

    func initialize(_ payload: CurrencyPreferencePayload) async -> Result<
        CurrencyPreference, CurrencyClientError
    > {
        let operation = "initialize"
        do {
            switch try await client.postAppApiAuthPreferences(
                body: .json(
                    .init(
                        preferredCurrency: PricedCardMapper.generatedCurrency(payload.preferredCurrency)
                    )
                )
            ) {
            case .ok(let response):
                let payload = try response.body.json
                return .success(
                    Self.preference(
                        currency: payload.value2.user.preferredCurrency
                    )
                )
            case .badRequest(let response):
                return .failure(
                    diagnose(
                        .badRequest(
                            validations: TCGClientValidationErrorParser.parseIssues(from: try? response.body.json)
                        ),
                        operation: operation,
                        reason: .validation,
                        status: 400
                    )
                )
            case .unauthorized:
                return .failure(diagnose(.unauthorized, operation: operation, reason: .unauthorized, status: 401))
            case .undocumented(let status, _):
                return .failure(diagnose(.unknown, operation: operation, reason: .unexpectedStatus, status: status))
            }
        } catch { return .failure(diagnose(error, operation: operation)) }
    }

    func update(_ payload: CurrencyPreferencePayload) async -> Result<
        CurrencyPreference, CurrencyClientError
    > {
        let operation = "update"
        do {
            switch try await client.patchAppApiAuthPreferences(
                body: .json(
                    .init(
                        preferredCurrency: PricedCardMapper.generatedCurrency(payload.preferredCurrency)
                    )
                )
            ) {
            case .ok(let response):
                let payload = try response.body.json
                return .success(
                    Self.preference(
                        currency: payload.value2.user.preferredCurrency
                    )
                )
            case .badRequest(let response):
                return .failure(
                    diagnose(
                        .badRequest(
                            validations: TCGClientValidationErrorParser.parseIssues(from: try? response.body.json)
                        ),
                        operation: operation,
                        reason: .validation,
                        status: 400
                    )
                )
            case .unauthorized:
                return .failure(diagnose(.unauthorized, operation: operation, reason: .unauthorized, status: 401))
            case .undocumented(let status, _):
                return .failure(diagnose(.unknown, operation: operation, reason: .unexpectedStatus, status: status))
            }
        } catch { return .failure(diagnose(error, operation: operation)) }
    }

    func latestRates() async -> Result<ExchangeRates, CurrencyClientError> {
        let operation = "latest_rates"
        do {
            switch try await client.getAppApiForexLatest() {
            case .ok(let response):
                let snapshot = try response.body.json
                let rates = snapshot.rates.additionalProperties
                guard rates["EUR"] == 1 else {
                    return .failure(diagnose(.unknown, operation: operation, reason: .invalidBase, status: 200))
                }
                guard rates.values.allSatisfy({ $0.isFinite && $0 > 0 }) else {
                    return .failure(diagnose(.unknown, operation: operation, reason: .invalidRates, status: 200))
                }
                return .success(.init(date: snapshot.date, rates: rates.mapValues { Decimal($0) }))
            case .unauthorized:
                return .failure(diagnose(.unauthorized, operation: operation, reason: .unauthorized, status: 401))
            case .serviceUnavailable:
                return .failure(diagnose(.unavailable, operation: operation, reason: .unavailable, status: 503))
            case .undocumented(let status, _):
                return .failure(diagnose(.unknown, operation: operation, reason: .unexpectedStatus, status: status))
            }
        } catch { return .failure(diagnose(error, operation: operation)) }
    }

    private enum FailureReason: String {
        case validation
        case unauthorized
        case unavailable
        case unexpectedStatus = "unexpected_status"
        case invalidBase = "invalid_base_rate"
        case invalidRates = "invalid_rate"
        case decoding = "decoding_failed"
        case transport = "transport_failed"
        case response = "response_processing_failed"
    }

    private func diagnose(
        _ failure: CurrencyClientError,
        operation: String,
        reason: FailureReason,
        status: Int? = nil
    ) -> CurrencyClientError {
        let message =
            "event=currency.request.failed; operation=\(operation); reason=\(reason.rawValue); status=\(status.map(String.init) ?? "none")"
        switch reason {
        case .unexpectedStatus, .invalidBase, .invalidRates, .decoding, .response:
            logger.error(message)
        case .validation, .unauthorized, .unavailable, .transport:
            logger.warning(message)
        }
        return failure
    }

    private func diagnose(_ error: any Error, operation: String) -> CurrencyClientError {
        let clientError = error as? OpenAPIRuntime.ClientError
        let cause = clientError?.underlyingError ?? error
        if cause is CancellationError || (cause as? URLError)?.code == .cancelled {
            logger.debug("event=currency.request.cancelled; operation=\(operation)")
            return .unknown
        }
        let reason: FailureReason
        if cause is DecodingError {
            reason = .decoding
        } else if clientError?.response != nil {
            reason = .response
        } else {
            reason = .transport
        }
        let status = clientError?.response?.status.code ?? (cause is DecodingError ? 200 : nil)
        return diagnose(.unknown, operation: operation, reason: reason, status: status)
    }

    private static func preference(currency: Components.Schemas.Currency)
        -> CurrencyPreference
    {
        .init(currency: PricedCardMapper.makeCurrency(currency))
    }
}
