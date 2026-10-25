import SwiftUI
import TCGClient

struct CollectionBackupSummary: View {
    let backup: CollectionBackup

    var body: some View {
        Section {
            ForEach(backup.collections) { collection in
                VStack(alignment: .leading) {
                    Text(verbatim: collection.name).font(.headline)
                    Text(
                        "\(collection.columns) × \(collection.rows) · Pages: \(collection.pages.count)",
                        bundle: .module
                    )
                    Text("\(cardCount(in: collection)) card entries", bundle: .module)
                }
            }
        } header: {
            Text("Restore these collections", bundle: .module)
        }
    }

    private func cardCount(in collection: CardBinderCollection) -> Int {
        backup.cards.filter { $0.collectionID == collection.id }.count
    }
}
