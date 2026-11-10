import SwiftUI

struct PortalConnectionSettings: View {
    @Binding var serviceURL: String
    @Binding var isPresented: Bool

    var body: some View {
        NavigationStack {
            Form {
                TextField(text: $serviceURL) { Text("Tailscale HTTPS URL", bundle: .module) }
                    .autocorrectionDisabled()
                Text(
                    "Use the HTTPS address supplied by Tailscale Serve on your Mac mini. Only selected Tailscale accounts can connect.",
                    bundle: .module
                )
                .foregroundStyle(.secondary)
            }
            .padding()
            .navigationTitle(Text("Connection", bundle: .module))
            .toolbar {
                Button {
                    isPresented = false
                } label: {
                    Text("Done", bundle: .module)
                }
            }
        }
        .frame(minWidth: 320, minHeight: 240)
    }

}
