//
//  TCGSettingsScreenSnapshotTests.swift
//  TCGFeatures
//

import KamaalAuth
import SwiftUI
import TCGSnapshotTesting
import Testing

@testable import TCGSettings

@Suite("TCGSettings Screen Snapshot Tests")
@MainActor
struct TCGSettingsScreenSnapshotTests {
    @Test
    func `Renders sign out and version`() async {
        let auth = KamaalAuth(client: PreviewKamaalAuthClient(), configuration: .init(appName: "TCG"))

        await assertScreenSnapshot(testName: #function) {
            NavigationStack { TCGSettingsScreen(version: AppVersion(marketing: "1.0", build: "1")) }
                .environment(auth)
        }
    }
}
