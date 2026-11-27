import SwiftUI

package struct CardArtworkPresentation: ViewModifier {
    @Binding private var group: CardVariantGroup?

    package init(group: Binding<CardVariantGroup?>) {
        _group = group
    }

    package func body(content: Content) -> some View {
        content.sheet(item: $group) { group in
            CardArtworkFlow(group: group)
        }
    }
}
