import Foundation

typealias PortalServer = Components.Schemas.PortalServer
typealias PortalRelease = Components.Schemas.PortalRelease
typealias PortalStage = Components.Schemas.PortalStage
typealias PortalApproval = PortalRelease.approvalPayload

struct PortalApprovalDecision: Sendable {
    let releaseID: String
    let approvalID: String
    let approved: Bool
    let requestID: String
}

typealias PortalApp = Components.Schemas.PortalApp

enum PortalAppPlatform: Sendable {
    case ios
    case macos
}

enum PortalDestination: String, CaseIterable, Identifiable {
    case server
    case ios
    case macos

    var id: Self { self }

    var title: String {
        switch self {
        case .server: String(localized: "Server release", bundle: .module)
        case .ios: String(localized: "iOS release", bundle: .module)
        case .macos: String(localized: "macOS release", bundle: .module)
        }
    }

    var appPlatform: PortalAppPlatform? {
        switch self {
        case .server: nil
        case .ios: .ios
        case .macos: .macos
        }
    }
}
