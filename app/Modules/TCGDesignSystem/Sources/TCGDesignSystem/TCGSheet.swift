import SwiftUI

extension View {
    /// Adds the standard navigation bar to content presented by SwiftUI's sheet.
    public func tcgSheet(
        _ title: Text,
        closeLabel: Text,
        closeDisabled: Bool = false,
        onClose: (() -> Void)? = nil
    ) -> some View {
        tcgSheet(title, closeLabel: closeLabel, closeDisabled: closeDisabled, onClose: onClose) { EmptyView() }
    }

    public func tcgSheet<Confirmation: View>(
        _ title: Text,
        closeLabel: Text,
        closeDisabled: Bool = false,
        onClose: (() -> Void)? = nil,
        @ViewBuilder confirmation: () -> Confirmation
    ) -> some View {
        TCGSheet(
            title: title,
            closeLabel: closeLabel,
            closeDisabled: closeDisabled,
            onClose: onClose,
            confirmation: confirmation(),
            content: self
        )
    }
}

private struct TCGSheet<Content: View, Confirmation: View>: View {
    @Environment(\.dismiss) private var dismiss

    let title: Text
    let closeLabel: Text
    let closeDisabled: Bool
    let onClose: (() -> Void)?
    let confirmation: Confirmation
    let content: Content

    var body: some View {
        NavigationStack {
            content
                .navigationTitle(title)
                .toolbarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(action: close) { closeLabel }
                            .keyboardShortcut(.cancelAction)
                            .disabled(closeDisabled)
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        confirmation
                    }
                }
        }
    }

    private func close() {
        if let onClose {
            onClose()
        } else {
            dismiss()
        }
    }
}
