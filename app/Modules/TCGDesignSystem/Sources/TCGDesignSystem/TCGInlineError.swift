import SwiftUI

public struct TCGInlineError: View {
    private let message: String

    public init(_ message: String) {
        self.message = message
    }

    public var body: some View {
        Text(verbatim: message).foregroundStyle(.red)
    }
}
