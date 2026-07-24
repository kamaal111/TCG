//
//  PricingErrors.swift
//  TCGClient
//

import OpenAPIRuntime

public enum SearchPricingErrors: Error, Equatable {
    case unauthorized
    case badRequest(validations: [TCGClientValidationIssue])
    case unavailable
    case unknown(status: Int, payload: OpenAPIRuntime.UndocumentedPayload?, cause: Error?)

    public static func == (lhs: Self, rhs: Self) -> Bool {
        switch (lhs, rhs) {
        case (.unauthorized, .unauthorized): true
        case (.badRequest(let lhsIssues), .badRequest(let rhsIssues)): lhsIssues == rhsIssues
        case (.unavailable, .unavailable): true
        case (.unknown(let lhsStatus, _, _), .unknown(let rhsStatus, _, _)): lhsStatus == rhsStatus
        default: false
        }
    }
}

public enum OwnedPricesErrors: Error, Equatable {
    case unauthorized
    case badRequest(validations: [TCGClientValidationIssue])
    case unavailable
    case unknown(status: Int, payload: OpenAPIRuntime.UndocumentedPayload?, cause: Error?)

    public static func == (lhs: Self, rhs: Self) -> Bool {
        switch (lhs, rhs) {
        case (.unauthorized, .unauthorized): true
        case (.badRequest(let lhsIssues), .badRequest(let rhsIssues)): lhsIssues == rhsIssues
        case (.unavailable, .unavailable): true
        case (.unknown(let lhsStatus, _, _), .unknown(let rhsStatus, _, _)): lhsStatus == rhsStatus
        default: false
        }
    }
}
