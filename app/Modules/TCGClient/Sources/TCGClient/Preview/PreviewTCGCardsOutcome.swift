//
//  PreviewTCGCardsOutcome.swift
//  TCGClient
//
//  Created by Kamaal M Farah on 7/20/26.
//

/// The deterministic cards outcome returned by ``PreviewTCGCardsClient``.
enum PreviewTCGCardsOutcome: Sendable {
    case success(cards: [Card])
    case empty
    case validationErrors([TCGClientValidationIssue])
    case notFound
    case serverUnavailable
}
