//
//  TCGSettingsScreenSnapshotTests.swift
//  TCGFeatures
//

import Foundation
import KamaalAuth
import SwiftUI
import TCGCurrency
import TCGSnapshotTesting
import Testing

@testable import TCGClient
@testable import TCGSettings

@Suite("TCGSettings Screen Snapshot Tests")
@MainActor
struct TCGSettingsScreenSnapshotTests {
    @Test(arguments: [false, true])
    func `Renders price privacy settings`(hidden: Bool) async {
        let privacy = TCGPricePrivacy(defaults: nil)
        privacy.hidePrices = hidden
        let auth = KamaalAuth(client: PreviewKamaalAuthClient(), configuration: .init(appName: "Mintomo"))
        #expect(privacy.hidePrices == hidden)
        await assertScreenSnapshot(testName: "Price privacy settings \(hidden)") {
            NavigationStack { TCGSettingsScreen(version: AppVersion(marketing: "1.0", build: "1")) }
                .environment(auth)
                .environment(\.tcgPricePrivacy, privacy)
        }
    }

    @Test
    func `Renders preferred currency settings`() async {
        let auth = KamaalAuth(client: PreviewKamaalAuthClient(), configuration: .init(appName: "Mintomo"))
        let currency = TCGCurrency(client: .preview(), defaults: nil)
        await currency.refresh()
        #expect(await currency.save(.eur))
        await assertScreenSnapshot(testName: #function) {
            NavigationStack { TCGSettingsScreen(version: AppVersion(marketing: "1.0", build: "1")) }
                .environment(auth)
                .environment(\.tcgCurrency, currency)
        }
    }

    @Test
    func `Renders card data actions`() async {
        let auth = KamaalAuth(client: PreviewKamaalAuthClient(), configuration: .init(appName: "Mintomo"))
        #expect(!auth.isLoggedIn)
        await assertScreenSnapshot(testName: #function) {
            NavigationStack {
                TCGSettingsScreen(
                    version: AppVersion(marketing: "1.0", build: "1"),
                    onExport: { .success(URL(fileURLWithPath: "/tmp/cards.csv")) },
                    onDownloadTemplate: { .success(URL(fileURLWithPath: "/tmp/cards-template.csv")) },
                    onImport: { _ in }
                )
            }
            .environment(auth)
        }
    }

    @Test
    func `Renders template download before file selection`() async {
        let screen = TCGCSVImportIntroduction(onDownloadTemplate: {}, onChooseFile: {}, onClose: {})
        #expect(AppVersion(marketing: "1.0", build: "1").displayText != nil)
        await assertScreenSnapshot(testName: #function) { screen }
    }

    @Test
    func `Renders sign out and version`() async {
        let auth = KamaalAuth(client: PreviewKamaalAuthClient(), configuration: .init(appName: "Mintomo"))

        await assertScreenSnapshot(testName: #function) {
            NavigationStack { TCGSettingsScreen(version: AppVersion(marketing: "1.0", build: "1")) }
                .environment(auth)
        }
    }
}
