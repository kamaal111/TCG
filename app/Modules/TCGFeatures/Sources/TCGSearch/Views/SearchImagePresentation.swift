import SwiftUI
import TCGClient
import TCGDesignSystem

struct SearchImagePresentation: ViewModifier {
    @Binding var group: SearchResultGroup?

    func body(content: Content) -> some View {
        content.sheet(item: $group) { group in
            SearchImageFlow(group: group)
        }
    }
}

private struct SearchImageFlow: View {
    let group: SearchResultGroup
    @State private var selectedURL: URL?

    var body: some View {
        if let url = selectedURL ?? group.directArtworkURL {
            CardImageExplorer(url: url)
        } else {
            SearchVariantPicker(variants: group.variants, purpose: .artwork, selectedID: group.card.id) { variant in
                selectedURL = group.artworkURL(for: variant.id)
            }
        }
    }
}
