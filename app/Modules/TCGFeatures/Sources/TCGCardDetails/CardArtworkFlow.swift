import SwiftUI
import TCGDesignSystem

struct CardArtworkFlow: View {
    let group: CardVariantGroup
    @State private var selectedURL: URL?

    var body: some View {
        if let url = selectedURL ?? group.directArtworkURL {
            CardImageExplorer(url: url)
        } else {
            CardVariantPicker(variants: group.variants, purpose: .artwork, selectedID: group.card.id) { variant in
                selectedURL = group.artworkURL(for: variant.id)
            }
        }
    }
}
