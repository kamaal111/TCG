//
//  TCGAuthValidationIssue.swift
//  TCGFeatures
//
//  Created by Codex on 7/14/26.
//

struct TCGAuthValidationIssue: Equatable, Sendable {
    let field: TCGAuthValidationField
    let message: String
}

enum TCGAuthValidationField: String, Hashable, Sendable {
    case email
    case verifyEmail
    case password
    case verifyPassword
    case name
}
