import Foundation
import Observation

@MainActor
@Observable
final class PortalModel {
    @ObservationIgnored private let client: any PortalClient
    private(set) var server: PortalServer?
    private(set) var release: PortalRelease?
    private(set) var error: String?
    private(set) var isWorking = false
    private var reviewAvailable = false
    @ObservationIgnored private var startRequest: StartRequest?
    @ObservationIgnored private var decisionRequest: PortalApprovalDecision?

    init(client: any PortalClient) {
        self.client = client
    }

    var isActive: Bool {
        release?.state == .running || release?.state == .approval
    }

    var canRetry: Bool {
        guard let release else { return false }
        guard let server else { return false }
        return release.sha == server.main && (release.state == .failed || release.state == .interrupted)
    }

    var canStart: Bool {
        guard let server else { return false }
        return reviewAvailable && (server.pending > 0 || canRetry) && server.blocker == nil
            && server.activeRelease == nil
            && !isActive && !isWorking
    }

    func refresh() async {
        switch await client.server(page: 0) {
        case .failure(let failure):
            reviewAvailable = false
            record(failure)
            return
        case .success(let status):
            server = status
        }
        reviewAvailable = true
        if let id = server?.activeRelease ?? server?.latestRelease {
            await loadRelease(id: id)
        } else if let current = release, isActive {
            await loadRelease(id: current.id)
        } else {
            error = nil
        }
    }

    func more() async {
        guard let page = server?.nextPage else { return }
        switch await client.server(page: page) {
        case .failure(let failure): record(failure)
        case .success(let next):
            guard let current = server else { return }
            guard current.main == next.main else {
                await refresh()
                return
            }
            guard current.host?.fingerprint == next.host?.fingerprint else {
                await refresh()
                return
            }
            var updated = current
            updated.commits += next.commits
            updated.nextPage = next.nextPage
            server = updated
        }
    }

    func start() async {
        guard canStart else { return }
        guard let server else { return }
        guard let fingerprint = server.host?.fingerprint else { return }
        isWorking = true
        defer { isWorking = false }
        let request: StartRequest
        if let startRequest, startRequest.sha == server.main, startRequest.fingerprint == fingerprint {
            request = startRequest
        } else {
            request = StartRequest(sha: server.main, fingerprint: fingerprint, id: UUID().uuidString)
            startRequest = request
        }
        switch await client.start(sha: request.sha, fingerprint: request.fingerprint, requestID: request.id) {
        case .failure(let failure): record(failure)
        case .success(let started):
            release = started
            startRequest = nil
            error = nil
        }
    }

    func decide(approved: Bool) async {
        guard !isWorking else { return }
        guard let release else { return }
        guard let approval = release.approval else { return }
        isWorking = true
        defer { isWorking = false }
        let request: PortalApprovalDecision
        if let decisionRequest, decisionRequest.approvalID == approval.id, decisionRequest.approved == approved {
            request = decisionRequest
        } else {
            request = PortalApprovalDecision(
                releaseID: release.id,
                approvalID: approval.id,
                approved: approved,
                requestID: UUID().uuidString
            )
            decisionRequest = request
        }
        switch await client.decide(request) {
        case .failure(let failure): record(failure)
        case .success(let updated):
            self.release = updated
            decisionRequest = nil
            error = nil
        }
    }

    func poll() async {
        guard let release else { return }
        guard isActive else { return }
        switch await client.release(id: release.id) {
        case .failure(let failure): record(failure)
        case .success(let updated):
            self.release = updated
            error = nil
            if !isActive { await refresh() }
        }
    }

    private func loadRelease(id: String) async {
        switch await client.release(id: id) {
        case .failure(let failure): record(failure)
        case .success(let loaded):
            release = loaded
            error = nil
        }
    }

    private func record(_ failure: PortalClientError) {
        if failure == .conflict {
            reviewAvailable = false
            startRequest = nil
        }
        error = failure.errorDescription
    }

    private struct StartRequest {
        let sha: String
        let fingerprint: String
        let id: String
    }
}
