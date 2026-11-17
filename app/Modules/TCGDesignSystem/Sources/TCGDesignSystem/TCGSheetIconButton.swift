import SwiftUI

/// An icon-only sheet action with a fixed hit target and localized accessibility label and help.
public struct TCGSheetIconButton: View {
    private let systemImage: String
    private let title: Text
    private let isLoading: Bool
    private let action: () -> Void

    public init(
        systemImage: String,
        title: Text,
        isLoading: Bool,
        action: @escaping () -> Void
    ) {
        self.systemImage = systemImage
        self.title = title
        self.isLoading = isLoading
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            Group {
                if isLoading {
                    ProgressView().controlSize(.small)
                } else {
                    Image(systemName: systemImage)
                }
            }
            .frame(width: 44, height: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.borderless)
        .disabled(isLoading)
        .accessibilityLabel(title)
        .help(title)
    }
}
