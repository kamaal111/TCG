import Combine
import KamaalAuth
import LocalAuthentication
import Network
import SwiftUI
import TCGCards
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
    private let content: (StartupCollection, @escaping () -> Void) -> Content
    private let client = TCGClient.default()
    @State private var startup = StartupCollection()
    @Binding private var didPromptForStartupUnlock: Bool
    @Environment(\.scenePhase) private var scenePhase
    @State private var connection: OfflineConnection?

    init(
        auth: KamaalAuth,
        offline: OfflineCollection,
        didPromptForStartupUnlock: Binding<Bool>,
        @ViewBuilder content: @escaping (StartupCollection, @escaping () -> Void) -> Content
    ) {
        self.auth = auth
        self.offline = offline
        _didPromptForStartupUnlock = didPromptForStartupUnlock
        self.content = content
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
                content(startup, { Task { await unlockStartupCollection() } })
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
                    OfflineCollectionBrowser(
                        download: offline,
                        snapshot: snapshot,
                        canClose: connection?.isConnected == true
                    )
                }
            }
        }
        .task { await trackOfflineNetwork() }
        .task { await trackStartupSession() }
        .task(id: canScheduleStartupUnlock) {
            guard canScheduleStartupUnlock else { return }
            guard (try? await Task.sleep(for: .seconds(1))) != nil, !Task.isCancelled else { return }
            guard canScheduleStartupUnlock, let account = client.startupCacheAccount else { return }
            guard
                TCGCards.hasStartupCache(for: account)
                    || offline.hasStartupDownload(for: account)
            else { return }
            guard startup.offer(for: account), !didPromptForStartupUnlock else { return }

            didPromptForStartupUnlock = true
            Task { await unlockStartupCollection() }
        }
        .onDisappear { startup.dismiss() }
        .onChange(of: auth.initiallyValidatingToken) { _, validating in
            if !validating { startup.cancelUnlock() }
        }
        .onReceive(NotificationCenter.default.publisher(for: TCGClient.sessionRejected).receive(on: RunLoop.main)) {
            _ in
            startup.dismiss()
            offline.remove()
        }
        .onChange(of: auth.session?.email, initial: true) { _, account in
            if let account, account != startup.account { startup.dismiss() }
            offline.setAccount(account)
            if connection?.isConnected == false { offline.openWithFreshToken() }
            refreshOfflineDownload()
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                if connection?.isConnected == false { offline.openWithFreshToken() }
                refreshOfflineDownload()
            }
            if phase == .background {
                startup.dismiss()
                offline.close()
            }
        }
    }

    private var canScheduleStartupUnlock: Bool {
        canOfferStartupUnlock && scenePhase == .active && !startup.didOffer
    }

    private var canOfferStartupUnlock: Bool {
        connection?.isConnected == true && scenePhase != .background && auth.initiallyValidatingToken
            && startup.isCollectionsTabSelected
    }

    private func trackStartupSession() async {
        for await state in auth.sessionStates() {
            if case .unauthenticated = state { startup.dismiss() }
        }
    }

    private func unlockStartupCollection() async {
        await startup.unlock(load: loadStartupCollection) { account in
            canOfferStartupUnlock && client.startupCacheAccount == account
        }
    }

    private func loadStartupCollection(using context: LAContext, account: String) async throws
        -> StartupCollection.Preview?
    {
        let reason = String(localized: "Unlock your saved cards", bundle: .module)
        guard try await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) else {
            return nil
        }
        guard !Task.isCancelled, canOfferStartupUnlock, client.startupCacheAccount == account else { return nil }

        if let cached = await TCGCards.startupCache(for: account) {
            return .init(account: account, cards: cached.cards, collections: cached.collections)
        }
        guard !Task.isCancelled, canOfferStartupUnlock, client.startupCacheAccount == account else { return nil }

        context.interactionNotAllowed = true
        guard let download = try await offline.startupDownload(for: account, using: context) else { return nil }

        return .init(account: account, cards: download.cards, collections: download.collections)
    }

    private func refreshOfflineDownload() {
        guard scenePhase == .active, auth.isLoggedIn, let connection, connection.isConnected else { return }
        offline.automaticSync(wifi: connection.isWiFi)
    }

    private func trackOfflineNetwork() async {
        for await update in OfflineConnection.updates() {
            if connection?.isConnected == false, update.isConnected { offline.close() }
            connection = update
            if !update.isConnected {
                startup.dismiss()
                if scenePhase == .active { offline.openWithFreshToken() }
            }
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
