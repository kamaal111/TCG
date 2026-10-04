import SwiftUI
import TCGClient
import TCGDesignSystem

struct SearchImagePresentation: ViewModifier {
    @Binding var card: PricedCard?

    func body(content: Content) -> some View {
        content.cardImage(url: Binding(get: { imageURL }, set: setImage(_:)))
    }

    private var imageURL: URL? {
        card?.imageURL
    }

    private func setImage(_ url: URL?) {
        if url == nil {
            card = nil
        }
    }
}
