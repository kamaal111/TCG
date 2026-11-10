import SwiftUI

struct PortalReleaseApproval: View {
    let approval: PortalApproval
    let isWorking: Bool
    let decide: (Bool) -> Void

    var body: some View {
        Group {
            if let review = approval.review {
                Text(verbatim: review.target)
                    .font(.headline)
                LabeledContent {
                    Text(verbatim: String(review.running?.prefix(12) ?? "—"))
                } label: {
                    Text("Running", bundle: .module)
                }
                if let pending = review.pendingMigrations {
                    Text("\(pending) pending migration steps", bundle: .module)
                }
            }
            Text(verbatim: approval.message)
            if approval.kind == .migrations {
                Text(
                    "Back up the database and confirm the running app supports the new schema. Migrations cannot be automatically undone.",
                    bundle: .module
                )
                .foregroundStyle(.secondary)
            }
            HStack {
                Button {
                    decide(false)
                } label: {
                    Text("Decline", bundle: .module)
                }
                Button {
                    decide(true)
                } label: {
                    Text("Approve", bundle: .module)
                }
                .buttonStyle(.borderedProminent)
            }
            .disabled(isWorking)
        }
    }
}
