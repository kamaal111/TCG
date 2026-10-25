import SwiftUI
import TCGClient

struct CollectionTitle: View {
    let collection: CardCollectionSummary

    var body: some View {
        collection.isUnfiled ? Text("Unfiled", bundle: .module) : Text(verbatim: collection.name)
    }
}
