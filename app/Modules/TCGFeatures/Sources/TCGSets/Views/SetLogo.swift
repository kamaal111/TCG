import SwiftUI
import TCGDesignSystem

struct SetLogo: View {
    let url: URL?

    var body: some View {
        Group {
            if let url {
                CardArtworkView(logoURL: url)
            } else {
                Image(systemName: "rectangle.stack")
                    .foregroundStyle(.secondary)
            }
        }
        .accessibilityHidden(true)
    }
}
