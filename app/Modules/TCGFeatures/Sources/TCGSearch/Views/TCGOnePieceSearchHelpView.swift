import SwiftUI

struct TCGOnePieceSearchHelpView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            TCGSearchHelpExampleView(
                "Card name", query: "Monkey D. Luffy", detail: "Search by a name in any supported language.")
            TCGSearchHelpExampleView(
                "Card number", query: "OP14-069", detail: "Use the full card number printed on the card.")
            TCGSearchHelpExampleView(
                "Name + card number", query: "Nami OP01-016",
                detail: "Combine a name and card number to narrow your search.")
        }
    }
}
