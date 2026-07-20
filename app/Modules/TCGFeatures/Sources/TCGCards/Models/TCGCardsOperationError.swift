//
//  TCGCardsOperationError.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/20/26.
//

import Foundation

enum TCGCardsOperationError: LocalizedError, Equatable {
    case validation([TCGCardsValidationIssue])
    case notFound
    case serverUnavailable

    var errorDescription: String? {
        switch self {
        case .validation: String(localized: "Please correct the highlighted fields.")
        case .notFound: String(localized: "This card is no longer in your collection.")
        case .serverUnavailable: String(localized: "The server is unavailable. Please try again.")
        }
    }
}
