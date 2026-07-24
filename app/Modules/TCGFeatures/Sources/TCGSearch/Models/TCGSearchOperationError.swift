//
//  TCGSearchOperationError.swift
//  TCGFeatures
//

import Foundation

enum TCGSearchOperationError: LocalizedError, Equatable {
    case invalidQuery
    case serverUnavailable

    var errorDescription: String? {
        switch self {
        case .invalidQuery: String(localized: "Enter at least two characters to search.")
        case .serverUnavailable: String(localized: "The server is unavailable. Please try again.")
        }
    }
}
