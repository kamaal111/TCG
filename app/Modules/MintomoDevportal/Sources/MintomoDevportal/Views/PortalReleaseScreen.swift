import SwiftUI

struct PortalReleaseScreen: View {
    let model: PortalModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                if let error = model.error {
                    Label(error, systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.orange)
                }
                if let release = model.release {
                    PortalReleaseProgress(release: release, model: model)
                }
                if let server = model.server {
                    Text(verbatim: server.target)
                        .font(.headline)
                    if let app = model.appStatus {
                        Text("Version \(app.version)", bundle: .module)
                        if let teamID = app.teamID { Text(verbatim: teamID) }
                        if let apiHost = app.apiHost { Text(verbatim: "https://\(apiHost)") }
                        Text(
                            "Uploads to App Store Connect. Processing and App Review happen separately.",
                            bundle: .module
                        )
                    }
                    if let blocker = server.blocker { Text(verbatim: blocker).foregroundStyle(.secondary) }
                    if !model.isActive {
                        Button {
                            Task { await model.start() }
                        } label: {
                            if model.canRetry {
                                Text("Retry release", bundle: .module)
                            } else {
                                Text("Start release", bundle: .module)
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(!model.canStart)
                    }
                    PortalPendingChanges(server: server) {
                        Task { await model.more() }
                    }
                }
            }
            .frame(maxWidth: 760, alignment: .leading)
            .padding(24)
            .frame(maxWidth: .infinity)
        }
        .navigationTitle(model.destination.title)
    }

}
