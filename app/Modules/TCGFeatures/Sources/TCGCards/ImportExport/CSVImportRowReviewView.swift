import SwiftUI

struct CSVImportRowReviewView: View {
    let row: CSVImportRow
    let issues: [CSVImportIssue]
    let needsCatalogMatch: Bool
    let onEdit: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(
                    systemName: isReady
                        ? "checkmark.circle.fill" : "exclamationmark.circle.fill"
                )
                .foregroundStyle(isReady ? .green : .orange)
                Text("Row \(row.id) · \(row[.condition]) · quantity: \(row[.quantity])", bundle: .module)
            }
            if row[.purchasePrice].isEmpty {
                Text("No purchase price", bundle: .module).font(.caption).foregroundStyle(.secondary)
            } else {
                Text("Purchase price: \(row[.purchasePrice]) \(row[.currency])", bundle: .module).font(.caption)
            }
            Button {
                onEdit()
            } label: {
                if issues.isEmpty && !needsCatalogMatch {
                    Text("Edit Purchase", bundle: .module)
                } else {
                    Text("Correct Row", bundle: .module)
                }
            }
            .accessibilityLabel(
                needsCatalogMatch
                    ? Text("Correct row \(row.id)", bundle: .module)
                    : Text("Edit purchase at row \(row.id)", bundle: .module)
            )
            ForEach(issues) { issue in
                CSVImportIssueView(issue: issue)
            }
            if !row.isIncluded && issues.isEmpty {
                Text("Excluded from import", bundle: .module).foregroundStyle(.secondary)
            }
        }
    }

    private var isReady: Bool { row.isIncluded && issues.isEmpty && !needsCatalogMatch }
}
