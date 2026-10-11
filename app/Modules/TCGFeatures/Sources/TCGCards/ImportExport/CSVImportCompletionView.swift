import SwiftUI

struct CSVImportCompletionView: View {
    @Environment(TCGCards.self) private var collection

    let completion: CardsImportCompletion
    let model: TCGCardsImportReviewModel
    let onDone: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Label {
                Text("Import Complete", bundle: .module)
            } icon: {
                Image(systemName: "checkmark.circle.fill")
            }
            .font(.title2).foregroundStyle(.green)
            Text("Cards imported: \(completion.result.importedCount)", bundle: .module)
            Text("Cards updated: \(completion.result.updatedCount)", bundle: .module)
            Text("Unchanged cards skipped: \(completion.result.skippedCount)", bundle: .module)
            Text("Invalid or excluded purchase rows skipped: \(model.invalidRowCount)", bundle: .module)
            Text("Cards removed during review: \(model.removedCardCount)", bundle: .module)
            if completion.needsRefresh {
                Text(
                    "Your import was saved, but the collection couldn’t refresh. Try refreshing when you’re connected.",
                    bundle: .module
                )
                Button {
                    Task {
                        let result = await collection.retryImportRefresh()
                        if result { model.completion = .init(result: completion.result, needsRefresh: false) }
                    }
                } label: {
                    Text("Retry Refresh", bundle: .module)
                }
            }
            Button {
                onDone()
            } label: {
                Text("Done", bundle: .module)
            }.buttonStyle(.borderedProminent)
        }
    }

}
