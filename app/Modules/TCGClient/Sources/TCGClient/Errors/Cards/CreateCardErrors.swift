//
//  CreateCardErrors.swift
//  TCGClient
//
//  Created by Kamaal M Farah on 7/20/26.
//

import Foundation
import OpenAPIRuntime

public enum CreateCardErrors: LocalizedError, Equatable {
    case badRequest(validations: [TCGClientValidationIssue])
    case unauthorized
    case unknown(status: Int, payload: OpenAPIRuntime.UndocumentedPayload?, cause: Error?)

    public var errorDescription: String? {
        switch self {
        case .badRequest:
            String(localized: "The card details are invalid.")
        case .unauthorized:
            String(localized: "Your session has expired. Please sign in again.")
        case .unknown:
            String(localized: "The card could not be added.")
        }
    }

    public static func == (lhs: CreateCardErrors, rhs: CreateCardErrors) -> Bool {
        switch (lhs, rhs) {
        case (.badRequest(let lhsValidations), .badRequest(let rhsValidations)):
            lhsValidations == rhsValidations
        case (.unauthorized, .unauthorized):
            true
        case (.unknown(let lhsStatus, _, _), .unknown(let rhsStatus, _, _)):
            lhsStatus == rhsStatus
        default:
            false
        }
    }
}
