import SwiftUI

public struct TCGLabeledTextField: View {
    private let title: Text
    @Binding private var text: String

    public init(title: Text, text: Binding<String>) {
        self.title = title
        _text = text
    }

    public var body: some View {
        LabeledContent {
            TextField(text: $text) { title }
                .multilineTextAlignment(.trailing)
                .labelsHidden()
        } label: {
            title
        }
    }
}
