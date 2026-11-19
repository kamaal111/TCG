import SwiftUI
import TCGClient
import TCGDesignSystem

struct CollectionSwitcher: View {
    @Environment(TCGCards.self) private var cards
    let collections: TCGCollections
    let actions: CollectionNavigationActions
    let systemCollections: [SystemCollectionID]

    var body: some View {
        TCGNavigationMenu {
            ForEach(systemCollections, id: \.self) { id in
                Button {
                    choose(.system(id))
                } label: {
                    CollectionNavigationLabel.system(id)
                }
            }
            ForEach(collections.namedCollections) { collection in
                Button {
                    choose(.named(collection.id))
                } label: {
                    CollectionNavigationLabel.named(collection)
                }
            }
            if !cards.isReadOnly {
                Divider()
                Button {
                    actions.create()
                } label: {
                    Text("New collection", bundle: .module)
                }
            }
        } label: {
            Label {
                Text("Collections", bundle: .module)
            } icon: {
                Image(systemName: collections.destination.available(in: systemCollections).systemImage)
            }
        }
        .help(Text("Choose a collection", bundle: .module))
    }

    private func choose(_ destination: CollectionDestination) {
        Task { await collections.select(destination, using: cards, loadsList: true) }
    }
}
