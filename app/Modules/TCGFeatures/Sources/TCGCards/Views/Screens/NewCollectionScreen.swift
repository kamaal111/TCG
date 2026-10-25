import SwiftUI
import TCGClient
import TCGDesignSystem

struct NewCollectionScreen: View {
    private enum Metrics {
        static let minimumWidth: CGFloat = 300
        static let minimumHeight: CGFloat = 200
    }

    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var isCreating = false
    @State private var error: CollectionsError?
    let create: (String) async -> Result<Void, CollectionsError>

    var body: some View {
        Form {
            TCGLabeledTextField(title: Text("Name", bundle: .module), text: $name)
                .disabled(isCreating)
            if let error { TCGInlineError(error.localizedDescription) }
        }
        .formStyle(.grouped)
        .navigationTitle(Text("New collection", bundle: .module))
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button {
                    dismiss()
                } label: {
                    Text("Cancel", bundle: .module)
                }
                .disabled(isCreating)
                .help(Text("Cancel", bundle: .module))
            }
            ToolbarItem(placement: .confirmationAction) {
                Button {
                    Task { await createCollection() }
                } label: {
                    if isCreating {
                        ProgressView().controlSize(.small)
                    } else {
                        Text("Create collection", bundle: .module)
                    }
                }
                .disabled(isCreating || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .help(Text("Create collection", bundle: .module))
                .keyboardShortcut(.defaultAction)
            }
        }
        .interactiveDismissDisabled(isCreating)
        .frame(minWidth: Metrics.minimumWidth, minHeight: Metrics.minimumHeight)
    }

    private func createCollection() async {
        guard !isCreating else { return }
        isCreating = true
        error = nil
        let result = await create(name.trimmingCharacters(in: .whitespacesAndNewlines))
        isCreating = false
        switch result {
        case .success: dismiss()
        case .failure(let failure): error = failure
        }
    }
}
