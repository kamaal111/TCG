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
            content: self
        ) {
            ToolbarItem(placement: .confirmationAction) { confirmation().tcgNavigationAccent() }
        }
    }

    /// Presents the standard sheet header with independent trailing icon actions.
    public func tcgSheetWithIconActions<AuxiliaryAction: View, PrimaryAction: View>(
        _ title: Text,
        closeLabel: Text,
        auxiliaryAction: AuxiliaryAction?,
        primaryAction: PrimaryAction
    ) -> some View {
        let auxiliaryAction = auxiliaryAction?.tcgNavigationAccent()
        let primaryAction = primaryAction.tcgNavigationAccent()
        #if os(macOS)
            return VStack(spacing: 0) {
                TCGSheetIconActionHeader(title: title, closeLabel: closeLabel) {
                    auxiliaryAction
                    primaryAction
                }
                Divider()
                self
            }
        #else
            return TCGSheet(title: title, closeLabel: closeLabel, closeDisabled: false, onClose: nil, content: self) {
                if let auxiliaryAction {
                    ToolbarItem(placement: .topBarTrailing) { auxiliaryAction }
                    if #available(iOS 26, *) {
                        ToolbarSpacer(.fixed, placement: .topBarTrailing)
                    }
                }
                ToolbarItem(placement: .topBarTrailing) { primaryAction }
            }
        #endif
    }
}

private struct TCGSheet<Content: View, Actions: ToolbarContent>: View {
    @Environment(\.dismiss) private var dismiss

    let title: Text
    let closeLabel: Text
    let closeDisabled: Bool
    let onClose: (() -> Void)?
    let content: Content

    @ToolbarContentBuilder let actions: Actions

    var body: some View {
        NavigationStack {
            content
                .navigationTitle(title)
                .toolbarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        TCGSheetCloseButton(label: closeLabel, isDisabled: closeDisabled, action: close)
                    }
                    actions
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

private struct TCGSheetCloseButton: View {
    let label: Text
    var isDisabled = false
    let action: () -> Void

    var body: some View {
        TCGNavigationButton(action: action) { label }
            .keyboardShortcut(.cancelAction)
            .disabled(isDisabled)
    }
}

#if os(macOS)
    private struct TCGSheetIconActionHeader<Actions: View>: View {
        @Environment(\.dismiss) private var dismiss

        let title: Text
        let closeLabel: Text

        @ViewBuilder let actions: Actions

        var body: some View {
            // A macOS sheet exposes a single native primary action.
            if #available(macOS 26, *) {
                header
                    .buttonStyle(.glass)
                    .controlSize(.large)
            } else {
                header.buttonStyle(.borderless)
            }
        }

        private var header: some View {
            HStack(spacing: 8) {
                TCGSheetCloseButton(label: closeLabel, action: dismiss.callAsFunction)
                Spacer(minLength: 0)
                title.font(.headline).accessibilityAddTraits(.isHeader)
                Spacer(minLength: 0)
                HStack(spacing: 8) { actions }
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
        }
    }
#endif
