//
//  TCGCardFormScreenSnapshotTests.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/20/26.
//

import SnapshotTesting
import SwiftUI
import Testing

@testable import TCGCards
@testable import TCGClient

@Suite("TCGCard Form Screen Snapshot Tests")
@MainActor
struct TCGCardFormScreenSnapshotTests {
    @Test
    func `Renders the empty add card form`() {
        let cards = TCGCards(client: .preview(cardsOutcome: .empty))

        assert(testName: #function) { makeScreen(cards: cards, model: TCGCardFormScreenModel(mode: .add)) }
    }

    @Test
    func `Renders the edit card form prefilled`() async throws {
        let cards = TCGCards(client: .preview(cardsOutcome: .success(cards: PreviewTCGCardsClient.sampleCards)))
        _ = await cards.loadCards()
        let cardToEdit = try #require(cards.cards.last)

        assert(testName: #function) { makeScreen(cards: cards, model: TCGCardFormScreenModel(mode: .edit(cardToEdit))) }
    }

    @Test
    func `Renders the add card form with validation errors`() async {
        let cards = TCGCards(client: .preview(cardsOutcome: .empty))
        let model = TCGCardFormScreenModel(mode: .add)
        _ = await model.submit(using: cards)

        assert(testName: #function) { makeScreen(cards: cards, model: model) }
    }

    private func makeScreen(cards: TCGCards, model: TCGCardFormScreenModel) -> some View {
        NavigationStack {
            TCGCardFormScreen(model: model)
        }
        .environment(cards)
    }

    private func assert<Screen: View>(testName: String, @ViewBuilder screen: () -> Screen) {
        for scheme in [ColorScheme.light, .dark] {
            #if os(macOS)
                let macOSScreen = makeMacOSScreen(screen: screen(), scheme: scheme)
                withExtendedLifetime(macOSScreen.window) {
                    assertSnapshot(
                        of: macOSScreen.view,
                        as: .image,
                        named: "\(scheme)",
                        testName: testName
                    )
                }
            #elseif os(iOS)
                assertSnapshot(
                    of: screen(),
                    as: .image(
                        layout: .device(config: .iPhone13),
                        traits: UITraitCollection(userInterfaceStyle: scheme == .dark ? .dark : .light)
                    ),
                    named: "iPhone-\(scheme)",
                    testName: testName
                )
            #endif
        }
    }

    #if os(macOS)
        private func makeMacOSScreen<Screen: View>(
            screen: Screen,
            scheme: ColorScheme
        ) -> (view: NSHostingView<some View>, window: NSWindow) {
            let hostingView = NSHostingView(rootView: screen.preferredColorScheme(scheme))
            hostingView.appearance = NSAppearance(named: scheme == .dark ? .darkAqua : .aqua)
            hostingView.frame = NSRect(x: 0, y: 0, width: 1_280, height: 960)
            hostingView.wantsLayer = true
            hostingView.layer?.backgroundColor = (scheme == .dark ? NSColor.black : NSColor.white).cgColor
            // Lists back onto NSTableView, which only materializes rows once the view lives in a window.
            let window = NSWindow(
                contentRect: hostingView.frame,
                styleMask: [.borderless],
                backing: .buffered,
                defer: false
            )
            window.contentView = hostingView
            window.layoutIfNeeded()

            return (hostingView, window)
        }
    #endif
}
