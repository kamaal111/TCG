import SwiftUI

public struct PortalScreen: View {
    @AppStorage("devportal.serviceURL") private var serviceURL = ""
    @Environment(\.scenePhase) private var scenePhase
    @State private var model: PortalModel?
    @State private var settingsPresented = false

    public init() {}

    public var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    if let model {
                        PortalDashboard(model: model)
                    } else {
                        PortalConnectionPrompt(settingsPresented: $settingsPresented)
                    }
                }
                .frame(maxWidth: 760, alignment: .leading)
                .padding(24)
                .frame(maxWidth: .infinity)
            }
            .navigationTitle(Text("Mintomo Devportal", bundle: .module))
            .toolbar {
                Button {
                    settingsPresented = true
                } label: {
                    Label {
                        Text("Connection settings", bundle: .module)
                    } icon: {
                        Image(systemName: "gearshape")
                    }
                }
                Button {
                    Task { await model?.refresh() }
                } label: {
                    Label {
                        Text("Refresh", bundle: .module)
                    } icon: {
                        Image(systemName: "arrow.clockwise")
                    }
                }
            }
            .sheet(isPresented: $settingsPresented) {
                PortalConnectionSettings(serviceURL: $serviceURL, isPresented: $settingsPresented)
            }
            .task(id: serviceURL) { await connect() }
            .task(id: scenePhase) {
                guard scenePhase == .active else { return }
                await model?.refresh()
                while !Task.isCancelled {
                    do { try await Task.sleep(for: .seconds(2)) } catch { return }
                    await model?.poll()
                }
            }
        }
        .frame(minWidth: 320, minHeight: 480)
    }

    private func connect() async {
        guard let url = URL(string: serviceURL) else {
            model = nil
            return
        }
        switch PortalClientImpl.connect(url: url) {
        case .failure:
            model = nil
        case .success(let client):
            let next = PortalModel(client: client)
            model = next
            await next.refresh()
        }
    }
}
