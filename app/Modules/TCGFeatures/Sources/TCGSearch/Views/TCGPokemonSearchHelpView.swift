import SwiftUI

struct TCGPokemonSearchHelpView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            TCGSearchHelpExampleView(
                "Card name", query: "Charizard", detail: "Search by a name in any supported language.")
            TCGSearchHelpExampleView(
                "Name + card number", query: "Charizard ex 199", detail: "Add a card number to narrow your search.")
            TCGSearchHelpExampleView(
                "Set + printed number", query: "sv5m 072/071",
                detail:
                    "Use the set code and the full number printed on the card, including leading zeros and the total."
            )
            TCGSearchHelpExampleView(
                "Exact set ID + card number", query: "sv5m_ja 72",
                detail: "A full set ID targets that expansion. The _ja suffix identifies a Japanese set."
            )
            Text(
                "English and Japanese cards are searched together. English names can also match translated names when available.",
                bundle: .module
            )
            .font(.callout)
            .foregroundStyle(.secondary)
        }
    }
}
