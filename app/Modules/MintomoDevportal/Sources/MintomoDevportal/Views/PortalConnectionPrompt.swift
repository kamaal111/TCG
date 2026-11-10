import SwiftUI

struct PortalConnectionPrompt: View {
    @Binding var settingsPresented: Bool

    var body: some View {
        ContentUnavailableView {
            Label {
                Text("Connect your release service", bundle: .module)
            } icon: {
                Image(systemName: "network")
            }
        } description: {
            Text("Enter the private Tailscale HTTPS address of your Mac mini.", bundle: .module)
        } actions: {
            Button {
                settingsPresented = true
            } label: {
                Text("Connection settings", bundle: .module)
            }
        }
    }
}
