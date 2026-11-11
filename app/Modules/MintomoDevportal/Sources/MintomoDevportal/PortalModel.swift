import Foundation
import Observation

@MainActor
@Observable
final class PortalModel {
    @ObservationIgnored private let client: any PortalClient
    private(set) var destination: PortalDestination = .server
    private(set) var appStatus: PortalApp?
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
        return reviewAvailable && (destination != .server || server.pending > 0 || canRetry) && server.blocker == nil
            && server.activeRelease == nil
            && !isActive && !isWorking
    }

    func select(_ destination: PortalDestination) async {
        self.destination = destination
        server = nil
        appStatus = nil
        release = nil
        startRequest = nil
        decisionRequest = nil
        reviewAvailable = false
        await refresh()
    }

    func refresh() async {
        let selected = destination
        if let platform = selected.appPlatform {
            let result = await client.app(platform: platform, page: 0)
            guard selected == destination else { return }
            switch result {
            case .failure(let failure):
                reviewAvailable = false
                record(failure)
                return
            case .success(let status):
                appStatus = status
                server = serverSnapshot(status)
            }
        } else {
            let result = await client.server(page: 0)
            guard selected == destination else { return }
            switch result {
            case .failure(let failure):
                reviewAvailable = false
                record(failure)
                return
            case .success(let status):
                server = status
            }
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
        let selected = destination
        if let platform = selected.appPlatform {
            let result = await client.app(platform: platform, page: page)
            guard selected == destination else { return }
            switch result {
            case .failure(let failure): record(failure)
            case .success(let status):
                guard status.main == server?.main else {
                    await refresh()
                    return
                }
                guard status.fingerprint == appStatus?.fingerprint else {
                    await refresh()
                    return
                }
                guard var current = server else { return }
                current.commits += serverSnapshot(status).commits
                current.nextPage = status.nextPage
                server = current
            }
            return
        }
        let result = await client.server(page: page)
        guard selected == destination else { return }
        switch result {
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
        guard let fingerprint = appStatus?.fingerprint ?? server.host?.fingerprint else { return }
        isWorking = true
        defer { isWorking = false }
        let request: StartRequest
        if let startRequest, startRequest.sha == server.main, startRequest.fingerprint == fingerprint {
            request = startRequest
        } else {
            request = StartRequest(sha: server.main, fingerprint: fingerprint, id: UUID().uuidString)
            startRequest = request
        }
        let selected = destination
        let result: Result<PortalRelease, PortalClientError>
        if let platform = selected.appPlatform {
            result = await client.startApp(
                platform: platform,
                sha: request.sha,
                fingerprint: request.fingerprint,
                requestID: request.id
            )
        } else {
            result = await client.start(sha: request.sha, fingerprint: request.fingerprint, requestID: request.id)
        }
        guard selected == destination else { return }
        switch result {
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
        let selected = destination
        let result = await client.decide(request)
        guard selected == destination else { return }
        switch result {
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
        let selected = destination
        let result = await client.release(id: release.id)
        guard selected == destination else { return }
        switch result {
        case .failure(let failure): record(failure)
        case .success(let updated):
            self.release = updated
            error = nil
            if !isActive { await refresh() }
        }
    }

    private func loadRelease(id: String) async {
        let selected = destination
        let result = await client.release(id: id)
        guard selected == destination else { return }
        switch result {
        case .failure(let failure): record(failure)
        case .success(let loaded):
            release = loaded
            error = nil
        }
    }

    private func serverSnapshot(_ status: PortalApp) -> PortalServer {
        .init(
            target: status.target,
            main: status.main,
            host: nil,
            pending: status.pending,
            commits: status.commits.map { .init(sha: $0.sha, subject: $0.subject, author: $0.author, date: $0.date) },
            nextPage: status.nextPage,
            blocker: status.blocker,
            activeRelease: status.activeRelease,
            latestRelease: status.latestRelease
        )
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
