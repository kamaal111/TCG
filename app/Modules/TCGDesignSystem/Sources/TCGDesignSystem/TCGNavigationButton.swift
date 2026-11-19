import SwiftUI

public struct TCGNavigationButton<Label: View>: View {
    private let action: () -> Void
    private let label: Label

    public init(action: @escaping () -> Void, @ViewBuilder label: () -> Label) {
        self.action = action
        self.label = label()
    }

    public var body: some View {
        Button(action: action) { label }
            .tcgNavigationAccent()
    }
}
