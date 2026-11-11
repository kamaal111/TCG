import SwiftUI

struct PortalReleaseProgress: View {
    let release: PortalRelease
    let model: PortalModel

    private var stages: [PortalStage] {
        if release.target == .ios || release.target == .macos { return [.checks, .archive, .upload] }
        return [.build, .migrations, .deploy, .verify]
    }

    var body: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 16) {
                Text(verbatim: String(release.sha.prefix(12)))
                    .font(.system(.body, design: .monospaced))
                ForEach(stages, id: \.self) { stage in
                    PortalReleaseStageRow(stage: stage, release: release)
                }
                if release.state == .succeeded {
                    Label {
                        if release.target == .ios || release.target == .macos {
                            Text("Uploaded to App Store Connect; processing pending", bundle: .module)
                        } else {
                            Text("Release checks passed", bundle: .module)
                        }
                    } icon: {
                        Image(systemName: "checkmark.circle.fill")
                    }
                    .foregroundStyle(.green)
                }
                if let failure = release.failure { Text(verbatim: failure).foregroundStyle(.orange) }
                if let approval = release.approval {
                    Divider()
                    PortalReleaseApproval(approval: approval, isWorking: model.isWorking) { approved in
                        Task { await model.decide(approved: approved) }
                    }
                }
                DisclosureGroup {
                    ForEach(Array(release.events.enumerated()), id: \.offset) { _, event in
                        Text(verbatim: event.message)
                            .font(.caption)
                    }
                } label: {
                    Text("Activity", bundle: .module)
                }
            }
            .padding(8)
        } label: {
            Text("Release progress", bundle: .module)
        }
    }

}
