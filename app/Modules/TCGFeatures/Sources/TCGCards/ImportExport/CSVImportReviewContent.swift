import SwiftUI

struct CSVImportReviewContent: View {
    @Environment(TCGCards.self) private var collection

    let model: TCGCardsImportReviewModel
    let actions: Actions

    struct Actions {
        let editCard: (CSVImportCard) -> Void
        let editRow: (CSVImportRow, UUID) -> Void
        let downloadTemplate: () -> Void
        let chooseAnotherFile: () -> Void
    }

    var body: some View {
        if let error = model.fatalError {
            Label {
                Text("We couldn’t read this CSV", bundle: .module)
            } icon: {
                Image(systemName: "exclamationmark.triangle.fill")
            }
            .font(.headline)
            .foregroundStyle(.red)
            Text(error).textSelection(.enabled)
        } else {
            Text(
                "Review, edit, or remove cards before importing. Your collection won’t change until you confirm.",
                bundle: .module
            )
            .foregroundStyle(.secondary)
            Text(
                "Cards ready: \(model.selectedCards.count) · purchases: \(model.selectedPurchaseCount)",
                bundle: .module
            )
            .font(.headline)
            if model.excludedRowCount > 0 {
                Text(
                    "Excluded source rows: \(model.excludedRowCount). Correct their issues or continue with the valid selection.",
                    bundle: .module
                )
                .foregroundStyle(.orange)
            }
            if model.cards.isEmpty {
                Text(
                    "This CSV has no cards. Add your cards to the template, then choose the file again.",
                    bundle: .module
                )
            }
            ForEach(model.cards) { card in
                CSVImportCardReviewView(
                    card: card,
                    serverIssues: model.serverIssues,
                    actions: .init(
                        edit: { actions.editCard(card) },
                        remove: { model.removeCard(id: card.id) },
                        editRow: { actions.editRow($0, card.id) }
                    )
                )
                .disabled(model.isSubmitting)
            }
            if let error = model.submissionError { Text(error).foregroundStyle(.red).textSelection(.enabled) }
            Button {
                Task { await model.submit(using: collection) }
            } label: {
                if model.isSubmitting {
                    ProgressView()
                } else {
                    Text("Import Cards (\(model.selectedCards.count))", bundle: .module)
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(!model.canImport)
            Text(
                "Matching IDs replace cards and their complete purchase history in your collection. Unchanged cards and excluded rows are skipped.",
                bundle: .module
            )
            .font(
                .caption
            )
            .foregroundStyle(.secondary)
        }
        VStack(alignment: .leading, spacing: 12) {
            Button {
                actions.downloadTemplate()
            } label: {
                Text("Download CSV Template", bundle: .module)
            }
            Button {
                actions.chooseAnotherFile()
            } label: {
                Text("Choose Another File…", bundle: .module)
            }
        }
        .disabled(model.isSubmitting)
    }
}
