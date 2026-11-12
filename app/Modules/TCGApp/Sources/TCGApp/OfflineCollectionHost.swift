import Combine
import KamaalAuth
import Network
import SwiftUI
import TCGClient

struct OfflineCollectionHost<Content: View>: View {
    private let auth: KamaalAuth
    private let offline: OfflineCollection
    private let content: Content
    @Environment(\.scenePhase) private var scenePhase
    @State private var connection: OfflineConnection?

    init(auth: KamaalAuth, offline: OfflineCollection, @ViewBuilder content: () -> Content) {
        self.auth = auth
        self.offline = offline
        self.content = content()
    }

    var body: some View {
        Group {
            if let snapshot = offline.opened {
                OfflineCollectionBrowser(download: offline, snapshot: snapshot)
            } else {
                content
                    .safeAreaInset(edge: .bottom) {
                        if offline.hasDownload, !auth.isLoggedIn || connection?.isConnected == false {
                            OfflineCollectionOpenButton(download: offline)
                                .padding()
                        }
                    }
            }
        }
        .task { await trackOfflineNetwork() }
        .onReceive(NotificationCenter.default.publisher(for: TCGClient.sessionRejected).receive(on: RunLoop.main)) {
            _ in
            offline.remove()
        }
        .onChange(of: auth.session?.email, initial: true) { _, account in
            if let account {
                offline.setAccount(account)
                refreshOfflineDownload()
            }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { refreshOfflineDownload() }
            if phase == .background { offline.close() }
        }
    }

    private func refreshOfflineDownload() {
        guard scenePhase == .active, auth.isLoggedIn, let connection, connection.isConnected else { return }
        offline.automaticSync(wifi: connection.isWiFi)
    }

    private func trackOfflineNetwork() async {
        for await update in OfflineConnection.updates() {
            connection = update
            refreshOfflineDownload()
        }
    }
}

private struct OfflineConnection: Sendable {
    let isConnected: Bool
    let isWiFi: Bool

    static func updates() -> AsyncStream<Self> {
        let monitor = NWPathMonitor()
        return AsyncStream { continuation in
            monitor.pathUpdateHandler = { path in
                continuation.yield(
                    Self(
                        isConnected: path.status == .satisfied,
                        isWiFi: path.usesInterfaceType(.wifi) || path.usesInterfaceType(.wiredEthernet)
                    )
                )
            }
            continuation.onTermination = { _ in monitor.cancel() }
            monitor.start(queue: DispatchQueue(label: "OfflineCollectionNetwork"))
        }
    }
}
