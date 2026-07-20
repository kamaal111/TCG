//
//  PreviewTCGCardsOutcome.swift
//  TCGClient
//
//  Created by Kamaal M Farah on 7/20/26.
//

enum PreviewTCGCardsOutcome: Sendable {
    case success(cards: [Card])
    case empty
    case validationErrors([TCGClientValidationIssue])
    case notFound
    case serverUnavailable
}
