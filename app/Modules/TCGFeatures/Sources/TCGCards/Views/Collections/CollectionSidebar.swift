import SwiftUI
import TCGClient

struct CollectionSidebar: View {
    @Environment(TCGCards.self) private var cards
    let collections: TCGCollections
    let systemCollections: [SystemCollectionID]

    var body: some View {
        List(
            selection: Binding<CollectionDestination?>(
                get: { collections.destination.available(in: systemCollections) },
                set: { selection in
                    guard let selection else { return }
                    guard selection != collections.destination.available(in: systemCollections) else { return }

                    Task { await collections.select(selection, using: cards, loadsList: true) }
                }
            )
        ) {
            ForEach(systemCollections, id: \.self) { id in
                CollectionNavigationLabel.system(id).tag(CollectionDestination.system(id))
            }
            ForEach(collections.namedCollections) { collection in
                CollectionNavigationLabel.named(collection).tag(CollectionDestination.named(collection.id))
            }
        }
        .navigationTitle(Text("Collections", bundle: .module))
    }
}
