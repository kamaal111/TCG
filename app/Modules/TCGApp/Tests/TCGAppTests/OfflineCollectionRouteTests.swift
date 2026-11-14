import Testing

@testable import TCGApp

struct OfflineCollectionRouteTests {
    @Test func `Waits for connectivity before showing live collections`() {
        #expect(OfflineCollectionRoute(isConnected: nil, hasDownload: true, isOpen: false) == .checkingConnection)
    }

    @Test func `Replacing the live screen on disconnect removes access to live alerts`() {
        #expect(OfflineCollectionRoute(isConnected: true, hasDownload: true, isOpen: false) == .live)
        #expect(OfflineCollectionRoute(isConnected: false, hasDownload: true, isOpen: false) == .unlock)
        #expect(OfflineCollectionRoute(isConnected: false, hasDownload: true, isOpen: true) == .downloaded)
        #expect(OfflineCollectionRoute(isConnected: true, hasDownload: true, isOpen: false) == .live)
    }

    @Test func `Cold launch offline without a completed copy explains how to download`() {
        #expect(OfflineCollectionRoute(isConnected: false, hasDownload: false, isOpen: false) == .noDownload)
    }
}
