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
}
