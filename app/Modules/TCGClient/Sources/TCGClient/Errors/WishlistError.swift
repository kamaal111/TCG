import Foundation

public enum WishlistError: LocalizedError, Equatable, Sendable {
    case unauthorized
    case notFound
    case validation([TCGClientValidationIssue])
    case unavailable

    public var errorDescription: String? {
        switch self {
        case .unauthorized: String(localized: "Sign in again to use your wishlist.", bundle: .module)
        case .notFound: String(localized: "Search again to get the latest card details.", bundle: .module)
        case .validation, .unavailable:
            String(localized: "The wishlist couldn’t be updated. Please try again.", bundle: .module)
        }
    }
}
