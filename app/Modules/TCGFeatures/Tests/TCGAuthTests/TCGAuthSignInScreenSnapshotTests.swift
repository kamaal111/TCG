//
//  TCGAuthSignInScreenSnapshotTests.swift
//  TCGFeatures
//
//  Created by Codex on 7/19/26.
//

import SnapshotTesting
import SwiftUI
import Testing

@testable import TCGAuth

@Suite("TCGAuth Sign In Screen Snapshot Tests")
@MainActor
struct TCGAuthSignInScreenSnapshotTests {
    @Test
    func `Renders the happy login state`() {
        #if os(macOS)
            assertSnapshot(of: makeMacOSScreen(), as: .image)
        #elseif os(iOS)
            assertSnapshot(
                of: makeScreen(),
                as: .image(layout: .device(config: .iPhone13)),
                named: "iPhone"
            )
        #endif
    }

    private func makeScreen() -> some View {
        let model = TCGAuthSignInScreenModel()
        model.email = "jane@example.com"
        model.password = "password123"

        return TCGAuthSignInScreen(model: model)
            .environment(makeAuth(transport: .sessionSuccess()))
            .preferredColorScheme(.light)
    }

    #if os(macOS)
        private func makeMacOSScreen() -> NSHostingView<some View> {
            let hostingView = NSHostingView(rootView: makeScreen())
            hostingView.appearance = NSAppearance(named: .aqua)
            hostingView.frame = NSRect(x: 0, y: 0, width: 1_280, height: 960)
            hostingView.wantsLayer = true
            hostingView.layer?.backgroundColor = NSColor.white.cgColor

            return hostingView
        }
    #endif
}
