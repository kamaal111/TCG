struct PreviewPortalClient: PortalClient {
    private let appStatus: PortalApp?
    private let status: PortalServer
    private let current: PortalRelease?
    private let failure: PortalClientError?

    init(
        status: PortalServer,
        current: PortalRelease? = nil,
        failure: PortalClientError? = nil,
        appStatus: PortalApp? = nil
    ) {
        self.appStatus = appStatus
        self.status = status
        self.current = current
        self.failure = failure
    }

    func app(platform: PortalAppPlatform, page: Int) async -> Result<PortalApp, PortalClientError> {
        if let failure { return .failure(failure) }
        guard let appStatus else { return .failure(.unavailable) }
        return .success(appStatus)
    }

    func startApp(platform: PortalAppPlatform, sha: String, fingerprint: String, requestID: String) async -> Result<
        PortalRelease, PortalClientError
    > {
        await release(id: requestID)
    }

    func server(page: Int) async -> Result<PortalServer, PortalClientError> {
        if let failure { return .failure(failure) }
        return .success(status)
    }

    func start(sha: String, fingerprint: String, requestID: String) async -> Result<PortalRelease, PortalClientError> {
        await release(id: requestID)
    }

    func release(id: String) async -> Result<PortalRelease, PortalClientError> {
        if let failure { return .failure(failure) }
        guard let current else { return .failure(.unavailable) }
        return .success(current)
    }

    func decide(_ decision: PortalApprovalDecision) async -> Result<PortalRelease, PortalClientError> {
        await release(id: decision.releaseID)
    }
}
