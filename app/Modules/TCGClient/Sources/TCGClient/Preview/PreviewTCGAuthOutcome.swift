//
//  PreviewTCGAuthOutcome.swift
//  TCGClient
//
//  Created by Codex on 7/19/26.
//

/// The deterministic authentication outcome returned by ``PreviewTCGAuthClient``.
enum PreviewTCGAuthOutcome: Sendable {
    case success
    case invalidCredentials
    case validationErrors([TCGClientValidationIssue])
    case sessionUnavailable
    case serverUnavailable
    case emailAlreadyInUse
}
