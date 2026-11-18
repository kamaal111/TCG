import SwiftUI
import TCGClient

struct CSVImportCardReviewView: View {
    let card: CSVImportCard
    let serverIssues: [CSVImportIssue]
    let lookup: CSVPrintingLookup?
    let selectedPrinting: PricedCard?
    let actions: Actions

    struct Actions {
        let edit: () -> Void
        let remove: () -> Void
        let editRow: (CSVImportRow) -> Void
        let choosePrinting: () -> Void
        let retryLookup: () -> Void
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(card.name.isEmpty ? String(localized: "Unnamed card", bundle: .module) : card.name).font(.headline)
            if let first = card.rows.first(where: \.isIncluded) ?? card.rows.first {
                Text(verbatim: "\(first[.setName]) · \(first[.cardNumber])")
                    .font(.subheadline)
                    .foregroundStyle(
                        .secondary
                    )
            }
            catalogStatus
            HStack {
                Button {
                    actions.edit()
                } label: {
                    Text("Edit Card", bundle: .module)
                }
                .disabled(CardsCSV.makeCard(card, now: Date()) == nil)
                Button(role: .destructive) {
                    actions.remove()
                } label: {
                    Text("Remove", bundle: .module)
                }
            }
            ForEach(card.rows) { row in
                CSVImportRowReviewView(
                    row: row,
                    issues: issues(for: row, in: card),
                    needsCatalogMatch: needsCatalogMatch
                ) {
                    actions.editRow(row)
                }
                if row.id != card.rows.last?.id { Divider() }
            }
        }
        .padding(16)
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
    }

    private var needsCatalogMatch: Bool {
        if case .noMatch = lookup { return true }
        return false
    }

    @ViewBuilder
    private var catalogStatus: some View {
        switch lookup {
        case nil:
            EmptyView()
        case .loading:
            ProgressView {
                Text("Finding a catalog printing…", bundle: .module)
            }
            .controlSize(.small)
        case .failed:
            Text("Catalog lookup failed. Try again.", bundle: .module)
                .foregroundStyle(.orange)
            retryButton
        case .noMatch:
            Text(
                "No catalog printing matches these rows. Correct the card fields or exclude the rows.",
                bundle: .module
            )
            .foregroundStyle(.orange)
            retryButton
        case .matches(let candidates):
            if let selectedPrinting {
                if let variant = selectedPrinting.variantName {
                    Text("Printing: \(variant)", bundle: .module)
                } else {
                    Text("Catalog printing matched", bundle: .module)
                }
                if card.rows.contains(where: { row in serverIssues.contains { $0.row == row.id } }) {
                    retryButton
                }
            } else if candidates.count > 1 {
                Text("Multiple printings match these rows. Choose the one you own.", bundle: .module)
                    .foregroundStyle(.orange)
            } else {
                Text("The previous printing is unavailable. Choose a printing to continue.", bundle: .module)
                    .foregroundStyle(.orange)
            }
            if selectedPrinting == nil || candidates.count > 1 {
                Button(action: actions.choosePrinting) {
                    Text("Choose Printing", bundle: .module)
                }
            }
        }
    }

    private var retryButton: some View {
        Button(action: actions.retryLookup) {
            Text("Retry Catalog Lookup", bundle: .module)
        }
    }

    private func issues(for row: CSVImportRow, in card: CSVImportCard) -> [CSVImportIssue] {
        var candidate = card
        for index in candidate.rows.indices where candidate.rows[index].id == row.id {
            candidate.rows[index].isIncluded = true
        }
        return (CardsCSV.issues(for: candidate) + serverIssues).filter { $0.row == row.id }
    }
}
