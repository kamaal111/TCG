import Foundation
import OpenAPIRuntime

enum PortalClientError: LocalizedError, Equatable {
    case invalidURL
    case unauthorized
    case forbidden
    case conflict
    case unavailable
    case unknown(status: Int, payload: UndocumentedPayload?, cause: (any Error)?)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            String(localized: "Enter the private Tailscale HTTPS address of your Mac mini.", bundle: .module)
        case .unauthorized:
            String(localized: "Connect to Tailscale using an allowed account.", bundle: .module)
        case .forbidden:
            String(localized: "Your Tailscale account is not allowed to use this portal.", bundle: .module)
        case .conflict:
            String(localized: "The release changed. Refresh and review it again.", bundle: .module)
        case .unavailable, .unknown:
            String(
                localized: "Cannot reach the release service. Check Tailscale and the Mac mini, then retry.",
                bundle: .module
            )
        }
    }

    static func == (lhs: Self, rhs: Self) -> Bool {
        switch (lhs, rhs) {
        case (.invalidURL, .invalidURL), (.unauthorized, .unauthorized), (.forbidden, .forbidden),
            (.conflict, .conflict), (.unavailable, .unavailable):
            true
        case (.unknown(let lhsStatus, _, _), .unknown(let rhsStatus, _, _)): lhsStatus == rhsStatus
        default: false
        }
    }
}
