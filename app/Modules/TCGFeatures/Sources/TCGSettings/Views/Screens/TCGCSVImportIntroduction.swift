import SwiftUI

struct TCGCSVImportIntroduction: View {
    let onDownloadTemplate: () -> Void
    let onChooseFile: () -> Void
    let onClose: () -> Void

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 20) {
                Text("Start with the CSV template", bundle: .module).font(.title2.weight(.semibold))
                Text(
                    "Download the template first, or choose a previous TCG export. Each row represents a purchase; use the same card ID for purchases of the same card.",
                    bundle: .module
                )
                Text(
                    "You’ll review every card, correct issues, and edit or remove cards before importing. Matching IDs update cards and replace their purchase history in your account.",
                    bundle: .module
                )
                .foregroundStyle(.secondary)
                Button(action: onDownloadTemplate) {
                    Label {
                        Text("Download CSV Template", bundle: .module)
                    } icon: {
                        Image(systemName: "arrow.down.doc")
                    }
                }
                Button(action: onChooseFile) {
                    Label {
                        Text("Choose File…", bundle: .module)
                    } icon: {
                        Image(systemName: "doc")
                    }
                }
                .buttonStyle(.borderedProminent)
                Spacer(minLength: 0)
            }
            .padding(24)
            .navigationTitle(Text("Import Cards", bundle: .module))
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(action: onClose) { Text("Close", bundle: .module) }
                }
            }
        }
        #if os(macOS)
            .frame(width: 500, height: 360)
        #endif
    }
}
