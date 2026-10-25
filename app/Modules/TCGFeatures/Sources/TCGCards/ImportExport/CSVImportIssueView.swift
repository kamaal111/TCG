import SwiftUI

struct CSVImportIssueView: View {
    let issue: CSVImportIssue

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text("\(issue.column.rawValue): ‘\(issue.value)’", bundle: .module)
                .font(
                    .subheadline.weight(.semibold)
                )
            Text(issue.explanation).font(.subheadline)
        }
        .foregroundStyle(.red)
        .textSelection(.enabled)
    }
}
