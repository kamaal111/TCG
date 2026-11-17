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
            actions: confirmation(),
            usesIconActions: false,
            content: self
        )
    }

    /// Presents the standard sheet header with independent trailing icon actions.
    public func tcgSheetWithIconActions<Actions: View>(
        _ title: Text,
        closeLabel: Text,
        @ViewBuilder actions: () -> Actions
    ) -> some View {
        TCGSheet(
            title: title,
            closeLabel: closeLabel,
            closeDisabled: false,
            onClose: nil,
            actions: actions(),
            usesIconActions: true,
            content: self
        )
    }
}

private struct TCGSheet<Content: View, Actions: View>: View {
    @Environment(\.dismiss) private var dismiss

    let title: Text
    let closeLabel: Text
    let closeDisabled: Bool
    let onClose: (() -> Void)?
    let actions: Actions
    let usesIconActions: Bool
    let content: Content

    var body: some View {
        if usesIconActions {
            VStack(spacing: 0) {
                HStack(spacing: 8) {
                    closeButton
                    Spacer(minLength: 0)
                    title.font(.headline).accessibilityAddTraits(.isHeader)
                    Spacer(minLength: 0)
                    HStack(spacing: 0) { actions }
                }
                .padding(.horizontal)
                .padding(.vertical, 4)
                Divider()
                content
            }
        } else {
            NavigationStack {
                content
                    .navigationTitle(title)
                    .toolbarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) { closeButton }
                        ToolbarItem(placement: .confirmationAction) { actions }
                    }
            }
        }
    }

    private var closeButton: some View {
        Button(action: close) { closeLabel }
            .keyboardShortcut(.cancelAction)
            .disabled(closeDisabled)
    }

    private func close() {
        if let onClose {
            onClose()
        } else {
            dismiss()
        }
    }
}
