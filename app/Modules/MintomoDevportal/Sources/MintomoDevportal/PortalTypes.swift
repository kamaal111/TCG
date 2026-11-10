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
