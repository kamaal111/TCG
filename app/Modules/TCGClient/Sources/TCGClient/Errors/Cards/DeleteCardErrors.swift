//
//  DeleteCardErrors.swift
//  TCGClient
//
//  Created by Kamaal M Farah on 7/20/26.
//

import Foundation
import OpenAPIRuntime

public enum DeleteCardErrors: LocalizedError, Equatable {
    case notFound
    case unauthorized
    case unknown(status: Int, payload: OpenAPIRuntime.UndocumentedPayload?, cause: Error?)

    public var errorDescription: String? {
        switch self {
        case .notFound:
            String(localized: "The card could not be found.")
        case .unauthorized:
            String(localized: "Your session has expired. Please sign in again.")
        case .unknown:
            String(localized: "The card could not be deleted.")
        }
    }

    public static func == (lhs: DeleteCardErrors, rhs: DeleteCardErrors) -> Bool {
        switch (lhs, rhs) {
        case (.notFound, .notFound):
            true
        case (.unauthorized, .unauthorized):
            true
        case (.unknown(let lhsStatus, _, _), .unknown(let rhsStatus, _, _)):
            lhsStatus == rhsStatus
        default:
            false
        }
    }
}
