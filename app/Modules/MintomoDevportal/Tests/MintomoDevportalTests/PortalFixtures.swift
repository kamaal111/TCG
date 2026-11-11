import Foundation

@testable import MintomoDevportal

enum PortalFixtures {
    static func server(pending: Int = 2, blocker: String? = nil, releaseID: String? = nil) throws -> PortalServer {
        let text = """
            {"target":"Mintomo production","main":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
             "host":{"protocol":1,"busy":false,"hostname":"api.example.com","repository":"ghcr.io/example/server",
                     "runtime":null,"revision":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","operationsRevision":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                     "fingerprint":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"},
             "pending":2,"commits":[
                {"sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","subject":"Add collection layouts","author":"Developer","date":"2026-11-10"},
                {"sha":"dddddddddddddddddddddddddddddddddddddddd","subject":"Improve card search","author":"Developer","date":"2026-11-09"}],
             "nextPage":null,"blocker":null,"activeRelease":null,"latestRelease":null}
            """
        var server = try JSONDecoder().decode(PortalServer.self, from: Data(text.utf8))
        server.pending = pending
        server.blocker = blocker
        server.activeRelease = releaseID
        if pending == 0 { server.commits = [] }
        return server
    }

    static func app(platform: String = "ios", blocker: String? = nil, releaseID: String? = nil, finished: Bool = false)
        throws -> PortalApp
    {
        let server = try server(blocker: blocker, releaseID: releaseID)
        return .init(
            target: "Mintomo · App Store Connect",
            main: server.main,
            host: nil,
            pending: server.pending,
            commits: server.commits.map { .init(sha: $0.sha, subject: $0.subject, author: $0.author, date: $0.date) },
            nextPage: nil,
            blocker: blocker,
            activeRelease: finished ? nil : releaseID,
            latestRelease: finished ? releaseID : nil,
            platform: platform == "ios" ? .ios : .macos,
            fingerprint: String(repeating: "c", count: 64),
            version: "1.0",
            teamID: "DXUKH9VF73",
            apiHost: "api.mintomo.com",
            uploaded: nil
        )
    }

    static func appRelease(state: String = "approval", platform: String = "ios") throws -> PortalRelease {
        var release = try release(state: state)
        release.target = platform == "ios" ? .ios : .macos
        release.stage = .upload
        release.events = []
        release.approval = .init(
            id: "33333333-3333-4333-8333-333333333333",
            kind: .upload,
            appReview: .init(
                platform: platform == "ios" ? .ios : .macos,
                sha: release.sha,
                version: "1.0",
                teamID: "DXUKH9VF73",
                apiHost: "api.mintomo.com",
                fingerprint: release.fingerprint
            ),
            review: nil,
            message: "Upload this signed archive to App Store Connect?"
        )
        if state != "approval" { release.approval = nil }
        if state == "failed" { release.failure = "Upload stopped. Check App Store Connect before retrying." }
        return release
    }

    static func release(state: String = "approval") throws -> PortalRelease {
        let text = """
            {"target":"server","id":"11111111-1111-4111-8111-111111111111","sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
             "fingerprint":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
             "requestId":"22222222-2222-4222-8222-222222222222","operator":"operator@example.com","createdAt":"2026-11-10T12:00:00Z",
             "state":"\(state)","stage":"migrations",
             "approval":{"id":"33333333-3333-4333-8333-333333333333","kind":"migrations","review":{"target":"Mintomo production","running":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","fingerprint":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","pendingMigrations":1},"message":"Apply 1 pending database migration?"},
             "events":[{"message":"Build and publish completed.","stage":"build","at":"2026-11-10T12:00:00Z"}],"decisions":[],"failure":null}
            """
        var release = try JSONDecoder().decode(PortalRelease.self, from: Data(text.utf8))
        if state != "approval" { release.approval = nil }
        if state == "failed" { release.failure = "Release stopped. Check the private log on the Mac mini, then retry." }
        return release
    }
}
