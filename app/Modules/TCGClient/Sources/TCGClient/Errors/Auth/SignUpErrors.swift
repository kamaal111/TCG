//
//  SignUpErrors.swift
//  TCGClient
//
//  Created by Kamaal M Farah on 7/11/26.
//

import OpenAPIRuntime

public enum SignUpErrors: Error, Equatable {
    case badRequest(validations: [TCGClientValidationIssue])
    case sessionUnavailable
    case credentialsUnavailable(cause: Error)
    case unknown(status: Int, payload: OpenAPIRuntime.UndocumentedPayload?, cause: Error?)
    case conflict

    public static func == (lhs: SignUpErrors, rhs: SignUpErrors) -> Bool {
        switch (lhs, rhs) {
        case (.badRequest(let lhsValidations), .badRequest(let rhsValidations)):
            lhsValidations == rhsValidations
        case (.sessionUnavailable, .sessionUnavailable):
            true
        case (.credentialsUnavailable, .credentialsUnavailable):
            true
        case (.unknown(let lhsStatus, _, _), .unknown(let rhsStatus, _, _)):
            lhsStatus == rhsStatus
        case (.conflict, .conflict):
            true
        default:
            false
        }
    }
}
