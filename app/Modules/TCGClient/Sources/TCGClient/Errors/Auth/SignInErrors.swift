//
//  SignInErrors.swift
//  TCGClient
//
//  Created by Kamaal M Farah on 7/12/26.
//

import OpenAPIRuntime

public enum SignInErrors: Error, Equatable {
    case badRequest(validations: [TCGClientValidationIssue])
    case unknown(status: Int, payload: OpenAPIRuntime.UndocumentedPayload?, cause: Error?)

    public static func == (lhs: SignInErrors, rhs: SignInErrors) -> Bool {
        switch (lhs, rhs) {
        case (.badRequest(let lhsValidations), .badRequest(let rhsValidations)):
            lhsValidations == rhsValidations
        case (.unknown(let lhsStatus, _, _), .unknown(let rhsStatus, _, _)):
            lhsStatus == rhsStatus
        default:
            false
        }
    }
}
