import Foundation
import HTTPTypes
import KamaalLogger
import OpenAPIRuntime

struct RequestDiagnosticsMiddleware: ClientMiddleware {
    private let logger: KamaalLogger

    init(logger: KamaalLogger) {
        self.logger = logger
    }

    func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @concurrent @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        guard let operation = Self.operation(request) else { return try await next(request, body, baseURL) }
        let started = ContinuousClock.now
        do {
            let result = try await next(request, body, baseURL)
            if result.0.status.code >= 400 {
                let requestID = HTTPField.Name("tcg-request-id").flatMap { result.0.headerFields[$0] }
                let fields: [LogField] = [
                    .init("operation", operation, privacy: .public),
                    .init("status", object: result.0.status.code, privacy: .public),
                    .init("request_id", Self.safeRequestID(requestID)),
                    .init("duration_ms", object: Self.milliseconds(since: started), privacy: .public),
                ]
                if result.0.status.code >= 500 {
                    logger.error("api.request.failed", fields: fields)
                } else {
                    logger.warning("api.request.failed", fields: fields)
                }
            }
            return result
        } catch {
            let cancelled = error is CancellationError || (error as? URLError)?.code == .cancelled
            let fields: [LogField] = [
                .init("operation", operation, privacy: .public),
                .init("reason", "transport_failed", privacy: .public),
                .init("status", "none", privacy: .public),
                .init("duration_ms", object: Self.milliseconds(since: started), privacy: .public),
            ]
            if cancelled {
                logger.debug("api.request.cancelled", fields: fields)
            } else {
                logger.warning("api.request.failed", fields: fields)
            }
            throw error
        }
    }

    static func processingFailure(
        _ error: any Error,
        operation: String,
        logger: KamaalLogger
    ) {
        let wrapped = error as? OpenAPIRuntime.ClientError
        let cause = wrapped?.underlyingError ?? error
        guard wrapped?.response != nil || cause is DecodingError else { return }
        let reason = cause is DecodingError ? "decoding_failed" : "response_processing_failed"
        let status = wrapped?.response?.status.code
        logger.error(
            "api.request.failed",
            fields: [
                .init("operation", operation, privacy: .public),
                .init("reason", reason, privacy: .public),
                .init("status", status.map(String.init) ?? "none", privacy: .public),
            ]
        )
    }

    static func mappingFailure(
        operation: String,
        logger: KamaalLogger
    ) {
        logger.error(
            "api.request.failed",
            fields: [
                .init("operation", operation, privacy: .public),
                .init("reason", "model_mapping_failed", privacy: .public),
                .init("status", "200", privacy: .public),
            ]
        )
    }

    private static func operation(_ request: HTTPRequest) -> String? {
        guard request.method == .get, let path = request.path?.split(separator: "?").first else { return nil }
        let components = path.split(separator: "/")
        if components == ["app-api", "cards"] { return "cards.list" }
        if components == ["app-api", "pricing", "search"] { return "pricing.search" }
        if components.count == 5 && components[0] == "app-api" && components[1] == "collections"
            && components[3] == "pages"
        {
            return "collections.page"
        }
        return nil
    }

    private static func safeRequestID(_ value: String?) -> String {
        guard let value, !value.isEmpty, value.count <= 128,
            value.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-") })
        else { return "none" }
        return value
    }

    private static func milliseconds(since started: ContinuousClock.Instant) -> Int64 {
        let elapsed = started.duration(to: .now).components
        return elapsed.seconds * 1000 + elapsed.attoseconds / 1_000_000_000_000_000
    }
}
