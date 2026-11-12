import Foundation
import Testing

@testable import TCGCards
@testable import TCGClient

struct BinderSlotDragPayloadTests {
    @Test func `Payload round trips with binder revision coordinates card and entire quantity`() throws {
        let payload = payload()
        #expect(try JSONDecoder().decode(BinderSlotDragPayload.self, from: JSONEncoder().encode(payload)) == payload)
        #expect(payload.matches(collection()))
    }

    @Test func `Foreign binders stale revisions changed contents and missing sources are rejected`() {
        let payload = payload()
        var stale = collection()
        stale.revision += 1
        #expect(!payload.matches(stale))
        var missing = collection()
        missing.pages = []
        #expect(!payload.matches(missing))
        var changed = collection()
        changed.pages[0].slots = [.init(row: 1, column: 1, cardID: CardsTestIDs.splitCard, quantity: 2)]
        #expect(!payload.matches(changed))
        changed.pages[0].slots = [.init(row: 1, column: 1, cardID: CardsTestIDs.overflowCard, quantity: 3)]
        #expect(!payload.matches(changed))
        let foreign = BinderSlotDragPayload(
            collectionID: CardsTestIDs.third,
            revision: 0,
            source: payload.source,
            cardID: payload.cardID,
            quantity: 3
        )
        #expect(!foreign.matches(collection()))
    }

    private func collection() -> CardBinderCollection {
        CollectionTestFixtures.collection(pages: [
            .init(
                id: CardsTestIDs.secondary,
                slots: [.init(row: 1, column: 1, cardID: CardsTestIDs.splitCard, quantity: 3)]
            )
        ])
    }

    private func payload() -> BinderSlotDragPayload {
        .init(
            collectionID: CardsTestIDs.primary,
            revision: 0,
            source: .init(pageID: CardsTestIDs.secondary, row: 1, column: 1),
            cardID: CardsTestIDs.splitCard,
            quantity: 3
        )
    }
}
