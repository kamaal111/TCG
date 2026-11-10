import Foundation
import Testing

@testable import MintomoDevportal

@MainActor
struct PortalModelTests {
    @Test func `Reattaches to an existing approval when refreshing`() async throws {
        let release = try PortalFixtures.release()
        let client = PreviewPortalClient(status: try PortalFixtures.server(releaseID: release.id), current: release)
        let model = PortalModel(client: client)
        await model.refresh()
        #expect(model.release?.approval?.kind == .migrations)
        #expect(model.isActive)
        #expect(!model.canStart)
    }

    @Test func `Prevents releases for empty or blocked servers`() async throws {
        let empty = PortalModel(client: PreviewPortalClient(status: try PortalFixtures.server(pending: 0)))
        await empty.refresh()
        #expect(!empty.canStart)
        let blocked = PortalModel(
            client: PreviewPortalClient(status: try PortalFixtures.server(blocker: "Run just release-server."))
        )
        await blocked.refresh()
        #expect(!blocked.canStart)
    }

    @Test func `Retries an interrupted release even when its commit is already installed`() async throws {
        let release = try PortalFixtures.release(state: "interrupted")
        let model = PortalModel(
            client: PreviewPortalClient(status: try PortalFixtures.server(pending: 0, releaseID: nil), current: release)
        )
        var status = try PortalFixtures.server(pending: 0)
        status.latestRelease = release.id
        let recovered = PortalModel(client: PreviewPortalClient(status: status, current: release))
        await model.refresh()
        #expect(!model.canStart)
        await recovered.refresh()
        #expect(recovered.canRetry)
        #expect(recovered.canStart)
    }

    @Test func `Shows a connection error for an account without access`() async throws {
        let model = PortalModel(client: PreviewPortalClient(status: try PortalFixtures.server(), failure: .forbidden))
        await model.refresh()
        #expect(model.error != nil)
        #expect(model.server == nil)
    }

    @Test func `Retries a failed release start with the same request ID`() async throws {
        let client = RetryClient(
            status: try PortalFixtures.server(),
            current: try PortalFixtures.release(state: "running")
        )
        let model = PortalModel(client: client)
        await model.refresh()
        await model.start()
        #expect(model.error != nil)
        await model.start()
        let requests = await client.requests
        #expect(requests.count == 2)
        #expect(requests.first == requests.last)
        #expect(model.release?.state == .running)
    }

    @Test func `Retries a failed approval with the same request ID`() async throws {
        let client = RetryClient(status: try PortalFixtures.server(), current: try PortalFixtures.release())
        let model = PortalModel(client: client)
        await model.refresh()
        await model.start()
        await model.start()
        await model.decide(approved: true)
        #expect(model.error != nil)
        await model.decide(approved: true)
        let decisions = await client.decisions
        #expect(decisions.count == 2)
        let first = try #require(decisions.first)
        let last = try #require(decisions.last)
        #expect(first.requestID == last.requestID)
        #expect(model.error == nil)
    }

    @Test func `Displays localized client failures without exposing their cause`() async throws {
        let model = PortalModel(
            client: PreviewPortalClient(
                status: try PortalFixtures.server(),
                failure: .unknown(status: 503, payload: nil, cause: URLError(.notConnectedToInternet))
            )
        )
        await model.refresh()
        let message = try #require(model.error)
        #expect(message == PortalClientError.unavailable.errorDescription)
    }

}

private actor RetryClient: PortalClient {
    private let status: PortalServer
    private let current: PortalRelease
    private(set) var requests: [String] = []
    private(set) var decisions: [PortalApprovalDecision] = []

    init(status: PortalServer, current: PortalRelease) {
        self.status = status
        self.current = current
    }

    func server(page: Int) async -> Result<PortalServer, PortalClientError> { .success(status) }

    func start(sha: String, fingerprint: String, requestID: String) async -> Result<PortalRelease, PortalClientError> {
        requests.append(requestID)
        if requests.count == 1 { return .failure(.unavailable) }
        return .success(current)
    }

    func release(id: String) async -> Result<PortalRelease, PortalClientError> { .success(current) }

    func decide(_ decision: PortalApprovalDecision) async -> Result<PortalRelease, PortalClientError> {
        decisions.append(decision)
        if decisions.count == 1 { return .failure(.unavailable) }
        return .success(current)
    }
}
