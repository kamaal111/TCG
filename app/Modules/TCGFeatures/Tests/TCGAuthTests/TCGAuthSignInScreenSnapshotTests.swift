//
//  TCGAuthSignInScreenSnapshotTests.swift
//  TCGFeatures
//
//  Created by Codex on 7/19/26.
//

import SnapshotTesting
import SwiftUI
import TCGClient
import Testing

@testable import TCGAuth

@Suite("TCGAuth Sign In Screen Snapshot Tests")
@MainActor
struct TCGAuthSignInScreenSnapshotTests {
    @Test
    func `Renders the sign in screen`() {
        let auth = TCGAuth(client: .preview(), cachedSessionStore: CachedUserSessionStoreSpy())

        #if os(macOS)
            assertSnapshot(of: makeMacOSScreen(auth: auth), as: .image)
        #elseif os(iOS)
            assertSnapshot(
                of: makeScreen(auth: auth),
                as: .image(layout: .device(config: .iPhone13)),
                named: "iPhone"
            )
        #endif
    }

    @Test
    func `Renders the signed in screen after signing up`() async {
        let auth = TCGAuth(client: .preview(), cachedSessionStore: CachedUserSessionStoreSpy())

        _ = await auth.signUp(name: "Jane Doe", email: "jane@example.com", password: "Password123!")

        #expect(auth.isLoggedIn)
        #if os(macOS)
            assertSnapshot(of: makeMacOSScreen(auth: auth), as: .image)
        #elseif os(iOS)
            assertSnapshot(
                of: makeScreen(auth: auth),
                as: .image(layout: .device(config: .iPhone13)),
                named: "iPhone"
            )
        #endif
    }

    private func makeScreen(auth: TCGAuth) -> some View {
        Text("Signed in")
            .tcgAuth(auth)
            .preferredColorScheme(.light)
    }

    #if os(macOS)
        private func makeMacOSScreen(auth: TCGAuth) -> NSHostingView<some View> {
            let hostingView = NSHostingView(rootView: makeScreen(auth: auth))
            hostingView.appearance = NSAppearance(named: .aqua)
            hostingView.frame = NSRect(x: 0, y: 0, width: 1_280, height: 960)
            hostingView.wantsLayer = true
            hostingView.layer?.backgroundColor = NSColor.white.cgColor

            return hostingView
        }
    #endif
}
