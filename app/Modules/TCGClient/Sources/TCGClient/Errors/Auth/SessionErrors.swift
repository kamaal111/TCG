//
//  SessionErrors.swift
//  TCGClient
//
//  Created by Kamaal M Farah on 7/12/26.
//

import Foundation
import OpenAPIRuntime

public enum SessionErrors: LocalizedError, Equatable {
    case unauthorized
    case unknown(status: Int, payload: OpenAPIRuntime.UndocumentedPayload?, cause: Error?)

    public var errorDescription: String? {
        switch self {
        case .unauthorized:
            String(localized: "Your session has expired. Please sign in again.")
        case .unknown:
            String(localized: "Your session could not be retrieved.")
        }
    }

    public static func == (lhs: SessionErrors, rhs: SessionErrors) -> Bool {
        switch (lhs, rhs) {
        case (.unauthorized, .unauthorized):
            true
        case (.unknown(let lhsStatus, _, _), .unknown(let rhsStatus, _, _)):
            lhsStatus == rhsStatus
        default:
            false
        }
    }
}
