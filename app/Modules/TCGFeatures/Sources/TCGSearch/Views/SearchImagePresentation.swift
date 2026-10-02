import SwiftUI
import TCGClient
import TCGDesignSystem

struct SearchImagePresentation: ViewModifier {
    @Binding var card: PricedCard?

    func body(content: Content) -> some View {
        #if os(macOS)
            content.sheet(item: $card) { card in
                CardImageExplorer(url: card.imageURL)
            }
        #else
            content.fullScreenCover(item: $card) { card in
                CardImageExplorer(url: card.imageURL)
            }
        #endif
    }
}
