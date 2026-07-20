//
//  TCGCardFormScreenSnapshotTests.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/20/26.
//

import SwiftUI
import TCGSnapshotTesting
import Testing

@testable import TCGCards
@testable import TCGClient

@Suite("TCGCard Form Screen Snapshot Tests")
@MainActor
struct TCGCardFormScreenSnapshotTests {
    @Test
    func `Renders an empty add form`() {
        assertScreenSnapshot(testName: #function) { makeScreen(model: .init(mode: .add)) }
    }

    @Test
    func `Renders a prefilled edit form`() {
        assertScreenSnapshot(testName: #function) {
            makeScreen(model: .init(mode: .edit(PreviewTCGCardsClient.sampleCards[0])))
        }
    }

    @Test
    func `Renders validation errors`() async {
        let model = TCGCardFormScreenModel(mode: .add)
        _ = await model.submit(using: TCGCards(client: .preview(cardsOutcome: .empty)))
        assertScreenSnapshot(testName: #function) { makeScreen(model: model) }
    }

    private func makeScreen(model: TCGCardFormScreenModel) -> some View {
        NavigationStack { TCGCardFormScreen(model: model) }
            .environment(TCGCards(client: .preview(cardsOutcome: .empty)))
    }
}
