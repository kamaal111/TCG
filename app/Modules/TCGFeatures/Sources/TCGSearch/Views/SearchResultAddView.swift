import SwiftUI
import TCGClient

struct SearchResultAddView<AddForm: View>: View {
    @State private var selection: PricedCard?

    let card: PricedCard
    let variants: [PricedCard]
    @ViewBuilder let addForm: (PricedCard) -> AddForm

    var body: some View {
        if variants.count < 2 {
            addForm(card)
        } else if let selection {
            addForm(selection)
        } else {
            SearchVariantPicker(variants: variants, purpose: .add) { selection = $0 }
        }
    }
}
