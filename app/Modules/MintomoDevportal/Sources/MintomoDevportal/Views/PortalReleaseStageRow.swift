import SwiftUI

struct PortalReleaseStageRow: View {
    let stage: PortalStage
    let release: PortalRelease

    var body: some View {
        HStack {
            Text(stageTitle(stage))
            Spacer()
            Text(stageStatus(stage, release: release))
                .foregroundStyle(.secondary)
        }
    }

    private func stageStatus(_ stage: PortalStage, release: PortalRelease) -> String {
        if release.state == .succeeded || stageOrder(stage) < stageOrder(release.stage) {
            return String(localized: "Complete", bundle: .module)
        }
        if stageOrder(stage) > stageOrder(release.stage) {
            return String(localized: "Not started", bundle: .module)
        }
        switch release.state {
        case .running: return String(localized: "In progress", bundle: .module)
        case .approval: return String(localized: "Waiting for approval", bundle: .module)
        case .failed: return String(localized: "Stopped", bundle: .module)
        case .interrupted: return String(localized: "Interrupted", bundle: .module)
        case .succeeded: return String(localized: "Complete", bundle: .module)
        }
    }

    private func stageOrder(_ stage: PortalStage) -> Int {
        switch stage {
        case .build, .checks: 0
        case .migrations, .archive: 1
        case .deploy, .upload: 2
        case .verify: 3
        }
    }

    private func stageTitle(_ stage: PortalStage) -> String {
        switch stage {
        case .checks: String(localized: "Check app", bundle: .module)
        case .archive: String(localized: "Archive and sign", bundle: .module)
        case .upload: String(localized: "Upload", bundle: .module)
        case .build: String(localized: "Build and publish", bundle: .module)
        case .migrations: String(localized: "Database migrations", bundle: .module)
        case .deploy: String(localized: "Deploy", bundle: .module)
        case .verify: String(localized: "Verify", bundle: .module)
        }
    }
}
