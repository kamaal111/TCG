import SwiftUI
import TCGClient

struct CardVariantLabel: View {
    let card: PricedCard

    var body: some View {
        if let name = card.variantName {
            Text(
                name.replacingOccurrences(of: "([a-z0-9])([A-Z])", with: "$1 $2", options: .regularExpression)
                    .capitalized
            )
        } else {
            Text("Standard", bundle: .module)
        }
    }
}
