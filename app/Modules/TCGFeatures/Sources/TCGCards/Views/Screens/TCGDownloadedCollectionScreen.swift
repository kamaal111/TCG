import SwiftUI
import TCGClient

public struct TCGDownloadedCollectionScreen: View {
    @State private var cards: TCGCards
    @State private var collections: TCGCollections

    public init(cards: [CardWithPrice], collections: [CardBinderCollection]) {
        let client = TCGClient.default()
        let cardState = TCGCards(client: client)
        let collectionState = TCGCollections(client: client, defaults: nil)
        cardState.useDownloadedCards(cards)
        collectionState.useDownload(cards: cards, collections: collections)
        _cards = State(initialValue: cardState)
        _collections = State(initialValue: collectionState)
    }

    public var body: some View {
        TCGCollectionsScreen()
            .environment(\.tcgCollections, collections)
            .tcgCards(cards)
    }
}
