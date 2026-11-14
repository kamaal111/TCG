import Combine
import KamaalAuth
import Network
import SwiftUI
import TCGClient

enum OfflineCollectionRoute: Equatable {
    case checkingConnection, live, unlock, noDownload, downloaded

    init(isConnected: Bool?, hasDownload: Bool, isOpen: Bool) {
        if isOpen {
            self = .downloaded
        } else {
            switch isConnected {
            case nil: self = .checkingConnection
            case true?: self = .live
            case false?: self = hasDownload ? .unlock : .noDownload
            }
        }
    }
}

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
            switch OfflineCollectionRoute(
                isConnected: connection?.isConnected,
                hasDownload: offline.hasDownload,
                isOpen: offline.opened != nil
            ) {
            case .checkingConnection:
                ProgressView()
            case .live:
                content
                    .safeAreaInset(edge: .bottom) {
                        if offline.hasDownload, !auth.isLoggedIn {
                            OfflineCollectionOpenButton(download: offline)
                                .padding()
                        }
                    }
            case .unlock:
                VStack(spacing: 12) {
                    Text("Offline collection", bundle: .module).font(.headline)
                    OfflineCollectionOpenButton(download: offline)
                }
                .padding()
            case .noDownload:
                ContentUnavailableView {
                    Label {
                        Text("Offline collection", bundle: .module)
                    } icon: {
                        Image(systemName: "wifi.slash")
                    }
                } description: {
                    Text(
                        "When you’re back online, use Download now in Settings to save your collections.",
                        bundle: .module
                    )
                }
            case .downloaded:
                if let snapshot = offline.opened {
                    OfflineCollectionBrowser(download: offline, snapshot: snapshot)
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
            if connection?.isConnected == false, update.isConnected { offline.close() }
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
