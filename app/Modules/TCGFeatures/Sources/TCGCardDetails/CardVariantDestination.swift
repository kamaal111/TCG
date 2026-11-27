import SwiftUI
import TCGClient

package struct CardVariantDestination<Destination: View>: View {
    @State private var selected: PricedCard?

    private let group: CardVariantGroup
    private let purpose: CardVariantPicker.Purpose
    private let destination: (PricedCard) -> Destination

    package init(
        group: CardVariantGroup,
        purpose: CardVariantPicker.Purpose,
        @ViewBuilder destination: @escaping (PricedCard) -> Destination
    ) {
        self.group = group
        self.purpose = purpose
        self.destination = destination
    }

    package var body: some View {
        if let card = group.destinationCard(selected: selected) {
            destination(card)
        } else {
            CardVariantPicker(variants: group.variants, purpose: purpose) { selected = $0 }
        }
    }
}
