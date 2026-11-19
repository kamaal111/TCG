import SwiftUI

public struct TCGNavigationMenu<Content: View, Label: View>: View {
    private let content: Content
    private let label: Label

    public init(@ViewBuilder content: () -> Content, @ViewBuilder label: () -> Label) {
        self.content = content()
        self.label = label()
    }

    public var body: some View {
        Menu {
            content
        } label: {
            label
        }
        .tcgNavigationAccent()
    }
}
