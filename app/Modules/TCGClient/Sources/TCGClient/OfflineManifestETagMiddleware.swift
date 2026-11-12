import Foundation
import HTTPTypes
import OpenAPIRuntime

// The generated OpenAPI header encoder percent-encodes quotes in string values.
struct OfflineManifestETagMiddleware: ClientMiddleware {
    func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @concurrent @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        var request = request
        if operationID == Operations.GetOfflineCollectionManifest.id,
            let validator = request.headerFields[.ifNoneMatch]?.removingPercentEncoding
        {
            request.headerFields[.ifNoneMatch] = validator
        }
        return try await next(request, body, baseURL)
    }
}
