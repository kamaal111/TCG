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
    func `Renders an empty add form`() async {
        await assertScreenSnapshot(testName: #function) { makeScreen(model: .init(mode: .add, initialValues: nil)) }
    }

    @Test
    func `Renders a searched Pokemon add form`() async {
        let card = PreviewTCGPricingClient.samplePricedCards[1]
        #expect(card.game == .pokemon)
        await assertScreenSnapshot(testName: #function) {
            NavigationStack { TCGCardFormScreen(pricedCard: card) }
                .environment(TCGCards(client: .preview(cardsOutcome: .empty)))
        }
    }

    @Test
    func `Renders a searched One Piece add form`() async {
        let card = PreviewTCGPricingClient.samplePricedCards[0]
        #expect(card.game == .onePiece)
        await assertScreenSnapshot(testName: #function) {
            NavigationStack { TCGCardFormScreen(pricedCard: card) }
                .environment(TCGCards(client: .preview(cardsOutcome: .empty)))
        }
    }

    @Test
    func `Renders a prefilled edit form`() async {
        await assertScreenSnapshot(testName: #function) {
            makeScreen(model: .init(mode: .edit(PreviewTCGCardsClient.sampleCards[0]), initialValues: nil))
        }
    }

    @Test
    func `Renders validation errors`() async {
        let model = TCGCardFormScreenModel(mode: .add, initialValues: nil)
        _ = await model.submit(using: TCGCards(client: .preview(cardsOutcome: .empty)))
        await assertScreenSnapshot(testName: #function) { makeScreen(model: model) }
    }

    private func makeScreen(model: TCGCardFormScreenModel) -> some View {
        NavigationStack { TCGCardFormScreen(model: model) }
            .environment(TCGCards(client: .preview(cardsOutcome: .empty)))
    }
}
