import SwiftUI
import TCGSnapshotTesting
import Testing

@testable import MintomoDevportal

@MainActor
struct MintomoDevportalScreenSnapshotTests {
    @Test func `Renders dashboard`() async throws {
        let model = PortalModel(client: PreviewPortalClient(status: try PortalFixtures.server()))
        await model.refresh()
        await assertScreenSnapshot(testName: #function) {
            NavigationStack {
                ScrollView { PortalDashboard(model: model).padding(24) }
                    .navigationTitle("Mintomo Devportal")
            }
        }
    }

    @Test func `Renders up to date`() async throws {
        let model = PortalModel(client: PreviewPortalClient(status: try PortalFixtures.server(pending: 0)))
        await model.refresh()
        await assertScreenSnapshot(testName: #function) {
            NavigationStack { ScrollView { PortalDashboard(model: model).padding(24) } }
        }
    }

    @Test func `Renders approval`() async throws {
        let release = try PortalFixtures.release()
        let model = PortalModel(
            client: PreviewPortalClient(status: try PortalFixtures.server(releaseID: release.id), current: release)
        )
        await model.refresh()
        await assertScreenSnapshot(testName: #function) { NavigationStack { PortalReleaseScreen(model: model) } }
    }

    @Test func `Renders blocked setup`() async throws {
        let model = PortalModel(
            client: PreviewPortalClient(
                status: try PortalFixtures.server(
                    blocker: "Server setup is required. Run just release-server on the Mac mini."
                )
            )
        )
        await model.refresh()
        await assertScreenSnapshot(testName: #function) { NavigationStack { PortalReleaseScreen(model: model) } }
    }

    @Test func `Renders failed release`() async throws {
        let release = try PortalFixtures.release(state: "failed")
        var status = try PortalFixtures.server()
        status.latestRelease = release.id
        let model = PortalModel(client: PreviewPortalClient(status: status, current: release))
        await model.refresh()
        await assertScreenSnapshot(testName: #function) { NavigationStack { PortalReleaseScreen(model: model) } }
    }

    @Test func `Renders app upload approval`() async throws {
        let release = try PortalFixtures.appRelease()
        let model = PortalModel(
            client: PreviewPortalClient(
                status: try PortalFixtures.server(),
                current: release,
                appStatus: try PortalFixtures.app(releaseID: release.id)
            )
        )
        await model.select(.ios)
        #expect(model.release?.approval?.kind == .upload)
        await assertScreenSnapshot(testName: #function) { NavigationStack { PortalReleaseScreen(model: model) } }
    }

    @Test func `Renders app setup blocker`() async throws {
        var status = try PortalFixtures.app(blocker: "Run just setup-app-release on the release Mac.")
        status.teamID = nil
        status.apiHost = nil
        status.fingerprint = nil
        let model = PortalModel(client: PreviewPortalClient(status: try PortalFixtures.server(), appStatus: status))
        await model.select(.ios)
        #expect(!model.canStart)
        await assertScreenSnapshot(testName: #function) { NavigationStack { PortalReleaseScreen(model: model) } }
    }

    @Test func `Renders app upload progress`() async throws {
        let release = try PortalFixtures.appRelease(state: "running", platform: "macos")
        let model = PortalModel(
            client: PreviewPortalClient(
                status: try PortalFixtures.server(),
                current: release,
                appStatus: try PortalFixtures.app(platform: "macos", releaseID: release.id)
            )
        )
        await model.select(.macos)
        #expect(model.isActive)
        await assertScreenSnapshot(testName: #function) { NavigationStack { PortalReleaseScreen(model: model) } }
    }

    @Test func `Renders app upload success`() async throws {
        let release = try PortalFixtures.appRelease(state: "succeeded", platform: "macos")
        var status = try PortalFixtures.app(platform: "macos", releaseID: release.id, finished: true)
        status.blocker = "This source and app configuration were already uploaded."
        status.uploaded = release.sha
        status.pending = 0
        status.commits = []
        let model = PortalModel(
            client: PreviewPortalClient(status: try PortalFixtures.server(), current: release, appStatus: status)
        )
        await model.select(.macos)
        #expect(model.release?.state == .succeeded)
        #expect(!model.canStart)
        await assertScreenSnapshot(testName: #function) { NavigationStack { PortalReleaseScreen(model: model) } }
    }

    @Test func `Renders app upload failure`() async throws {
        let release = try PortalFixtures.appRelease(state: "failed")
        let model = PortalModel(
            client: PreviewPortalClient(
                status: try PortalFixtures.server(),
                current: release,
                appStatus: try PortalFixtures.app(releaseID: release.id, finished: true)
            )
        )
        await model.select(.ios)
        #expect(model.release?.state == .failed)
        #expect(model.canStart)
        await assertScreenSnapshot(testName: #function) { NavigationStack { PortalReleaseScreen(model: model) } }
    }
}
