import SwiftUI

extension EnvironmentValues {
    @Entry public var tcgSettingsPresentation: Binding<Bool>?
}

extension View {
    public func tcgRootSettingsButton() -> some View {
        modifier(TCGRootSettingsButton())
    }
}

private struct TCGRootSettingsButton: ViewModifier {
    @Environment(\.tcgSettingsPresentation) private var presentation

    func body(content: Content) -> some View {
        #if os(iOS)
            content.toolbar {
                if presentation != nil {
                    ToolbarItem(placement: .topBarTrailing) {
                        TCGSettingsButton()
                    }
                }
            }
        #else
            content
        #endif
    }
}
