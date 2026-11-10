import SwiftUI

struct PortalDashboard: View {
    let model: PortalModel

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let error = model.error {
                Label(error, systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.orange)
            }
            GroupBox {
                VStack(alignment: .leading, spacing: 16) {
                    if let server = model.server {
                        LabeledContent {
                            Text(verbatim: String(server.host?.revision?.prefix(7) ?? "—"))
                        } label: {
                            Text("Running", bundle: .module)
                        }
                        LabeledContent {
                            Text(verbatim: String(server.main.prefix(7)))
                        } label: {
                            Text("Remote main", bundle: .module)
                        }
                        if server.pending == 0 {
                            Label {
                                Text("Up to date", bundle: .module)
                            } icon: {
                                Image(systemName: "checkmark.circle")
                            }
                        } else {
                            Text("\(server.pending) pending commits", bundle: .module)
                        }
                        NavigationLink {
                            PortalReleaseScreen(model: model)
                        } label: {
                            Text("Review release", bundle: .module)
                        }
                        if let blocker = server.blocker { Text(verbatim: blocker).foregroundStyle(.secondary) }
                    } else {
                        Text("Loading server status…", bundle: .module)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(8)
            } label: {
                Label {
                    Text("Server release", bundle: .module)
                } icon: {
                    Image(systemName: "shippingbox")
                }
            }
        }
    }
}
