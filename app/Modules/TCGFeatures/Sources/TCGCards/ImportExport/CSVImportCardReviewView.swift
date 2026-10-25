import SwiftUI

struct CSVImportCardReviewView: View {
    let card: CSVImportCard
    let serverIssues: [CSVImportIssue]
    let actions: Actions

    struct Actions {
        let edit: () -> Void
        let remove: () -> Void
        let editRow: (CSVImportRow) -> Void
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(card.name.isEmpty ? String(localized: "Unnamed card", bundle: .module) : card.name).font(.headline)
            if let first = card.rows.first {
                Text(verbatim: "\(first[.setName]) · \(first[.cardNumber])")
                    .font(.subheadline)
                    .foregroundStyle(
                        .secondary
                    )
            }
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
                CSVImportRowReviewView(row: row, issues: issues(for: row, in: card)) { actions.editRow(row) }
                if row.id != card.rows.last?.id { Divider() }
            }
        }
        .padding(16)
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
    }

    private func issues(for row: CSVImportRow, in card: CSVImportCard) -> [CSVImportIssue] {
        var candidate = card
        for index in candidate.rows.indices where candidate.rows[index].id == row.id {
            candidate.rows[index].isIncluded = true
        }
        return (CardsCSV.issues(for: candidate) + serverIssues).filter { $0.row == row.id }
    }
}
