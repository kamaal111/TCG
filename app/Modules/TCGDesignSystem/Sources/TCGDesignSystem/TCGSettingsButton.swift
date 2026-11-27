import SwiftUI

public struct TCGSettingsButton: View {
    @Environment(\.tcgSettingsPresentation) private var presentation

    public init() {}

    public var body: some View {
        if let presentation {
            Button {
                presentation.wrappedValue = true
            } label: {
                Label {
                    Text("Settings", bundle: .module)
                } icon: {
                    Image(systemName: "gearshape")
                }
            }
        }
    }
}
