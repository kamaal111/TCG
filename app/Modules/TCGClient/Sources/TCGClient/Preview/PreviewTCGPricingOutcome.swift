//
//  PreviewTCGPricingOutcome.swift
//  TCGClient
//

enum PreviewTCGPricingOutcome: Sendable {
    case success
    case empty
    case noResults
    case unauthorized
    case serverUnavailable
}
