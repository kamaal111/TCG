import SwiftUI
import TCGClient

struct CollectionImportPreviewRows: View {
    let preview: CollectionBackupPreview

    var body: some View {
        LabeledContent {
            Text("\(preview.newCollectionCount)")
        } label: {
            Text("New collections", bundle: .module)
        }
        LabeledContent {
            Text("\(preview.updatedCollectionCount)")
        } label: {
            Text("Layouts to restore", bundle: .module)
        }
        LabeledContent {
            Text("\(preview.newCardCount)")
        } label: {
            Text("Cards to add", bundle: .module)
        }
        LabeledContent {
            Text("\(preview.updatedCardCount)")
        } label: {
            Text("Cards to update", bundle: .module)
        }
        LabeledContent {
            Text("\(preview.movedCardCount)")
        } label: {
            Text("Cards to move", bundle: .module)
        }
    }
}
