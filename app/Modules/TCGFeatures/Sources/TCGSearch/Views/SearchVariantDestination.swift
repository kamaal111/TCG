import SwiftUI
import TCGClient

struct SearchVariantDestination<Destination: View>: View {
    @State private var selected: PricedCard?

    let group: SearchResultGroup
    let purpose: SearchVariantPicker.Purpose
    @ViewBuilder let destination: (PricedCard) -> Destination

    var body: some View {
        if let card = group.destinationCard(selected: selected) {
            destination(card)
        } else {
            SearchVariantPicker(variants: group.variants, purpose: purpose) { selected = $0 }
        }
    }
}
