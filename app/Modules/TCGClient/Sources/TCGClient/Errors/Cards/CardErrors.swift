//
//  CardErrors.swift
//  TCGClient
//
//  Created by Kamaal M Farah on 7/21/26.
//

import OpenAPIRuntime

public enum ListCardsErrors: Error, Equatable {
    case unauthorized
    case unknown(status: Int, payload: OpenAPIRuntime.UndocumentedPayload?, cause: Error?)

    public static func == (lhs: Self, rhs: Self) -> Bool {
        switch (lhs, rhs) {
        case (.unauthorized, .unauthorized): true
        case (.unknown(let lhsStatus, _, _), .unknown(let rhsStatus, _, _)): lhsStatus == rhsStatus
        default: false
        }
    }
}

public enum CreateCardErrors: Error, Equatable {
    case badRequest(validations: [TCGClientValidationIssue])
    case unauthorized
    case unknown(status: Int, payload: OpenAPIRuntime.UndocumentedPayload?, cause: Error?)

    public static func == (lhs: Self, rhs: Self) -> Bool {
        switch (lhs, rhs) {
        case (.badRequest(let lhsIssues), .badRequest(let rhsIssues)): lhsIssues == rhsIssues
        case (.unauthorized, .unauthorized): true
        case (.unknown(let lhsStatus, _, _), .unknown(let rhsStatus, _, _)): lhsStatus == rhsStatus
        default: false
        }
    }
}

public enum UpdateCardErrors: Error, Equatable {
    case badRequest(validations: [TCGClientValidationIssue])
    case notFound
    case unauthorized
    case unknown(status: Int, payload: OpenAPIRuntime.UndocumentedPayload?, cause: Error?)

    public static func == (lhs: Self, rhs: Self) -> Bool {
        switch (lhs, rhs) {
        case (.badRequest(let lhsIssues), .badRequest(let rhsIssues)): lhsIssues == rhsIssues
        case (.notFound, .notFound), (.unauthorized, .unauthorized): true
        case (.unknown(let lhsStatus, _, _), .unknown(let rhsStatus, _, _)): lhsStatus == rhsStatus
        default: false
        }
    }
}

public enum DeleteCardErrors: Error, Equatable {
    case notFound
    case unauthorized
    case unknown(status: Int, payload: OpenAPIRuntime.UndocumentedPayload?, cause: Error?)

    public static func == (lhs: Self, rhs: Self) -> Bool {
        switch (lhs, rhs) {
        case (.notFound, .notFound), (.unauthorized, .unauthorized): true
        case (.unknown(let lhsStatus, _, _), .unknown(let rhsStatus, _, _)): lhsStatus == rhsStatus
        default: false
        }
    }
}
