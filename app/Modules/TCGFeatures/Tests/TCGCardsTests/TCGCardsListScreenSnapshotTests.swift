//
//  TCGCardsListScreenSnapshotTests.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/20/26.
//

import SnapshotTesting
import SwiftUI
import Testing

@testable import TCGCards
@testable import TCGClient

@Suite("TCGCards List Screen Snapshot Tests")
@MainActor
struct TCGCardsListScreenSnapshotTests {
    @Test
    func `Renders the populated card list`() async {
        let cards = TCGCards(client: .preview(cardsOutcome: .success(cards: PreviewTCGCardsClient.sampleCards)))
        _ = await cards.loadCards()

        assert(testName: #function) { makeScreen(cards: cards) }
    }

    @Test
    func `Renders the empty card list`() async {
        let cards = TCGCards(client: .preview(cardsOutcome: .empty))
        _ = await cards.loadCards()

        assert(testName: #function) { makeScreen(cards: cards) }
    }

    @Test
    func `Renders the card list filtered to One Piece`() async {
        let cards = TCGCards(client: .preview(cardsOutcome: .success(cards: PreviewTCGCardsClient.sampleCards)))
        _ = await cards.loadCards()
        let model = TCGCardsListScreenModel()
        model.gameFilter = .onePiece

        assert(testName: #function) { makeScreen(cards: cards, model: model) }
    }

    private func makeScreen(cards: TCGCards, model: TCGCardsListScreenModel = TCGCardsListScreenModel()) -> some View {
        NavigationStack {
            TCGCardsListScreen(model: model)
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
