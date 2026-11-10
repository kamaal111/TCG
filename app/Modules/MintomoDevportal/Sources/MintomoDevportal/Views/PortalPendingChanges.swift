import SwiftUI

struct PortalPendingChanges: View {
    let server: PortalServer
    let loadMore: () -> Void

    var body: some View {
        Group {
            Text("Pending changes", bundle: .module)
                .font(.title2)
            ForEach(server.commits, id: \.sha) { commit in
                VStack(alignment: .leading, spacing: 4) {
                    Text(verbatim: commit.subject)
                    Text(verbatim: "\(commit.sha.prefix(7)) · \(commit.author) · \(commit.date)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Divider()
            }
            if server.nextPage != nil {
                Button {
                    loadMore()
                } label: {
                    Text("More commits", bundle: .module)
                }
            }
        }
    }
}
