import SwiftUI
import TCGCardDetails
import TCGClient
import TCGCurrency
import TCGDesignSystem

struct TCGSearchDetailView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.tcgCurrency) private var currencyState
    @Environment(TCGSearch.self) private var search

    let card: PricedCard

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Card details", bundle: .module).font(.headline)
                Spacer()
                Button {
                    dismiss()
                } label: {
                    Text("Done", bundle: .module)
                }
                .keyboardShortcut(.cancelAction)
            }
            .padding()
            Divider()
            if let displayedCard {
                CardDetailContent(metadata: .init(card: displayedCard), price: displayedCard) { EmptyView() }
            } else if search.isSearching {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                Button {
                    Task { await search.refresh() }
                } label: {
                    Text("Search again for current prices", bundle: .module)
                }.frame(maxWidth: .infinity, maxHeight: .infinity)
            }

        }
        .background(.background)
        #if os(macOS)
            .frame(minWidth: 480, idealWidth: 600, maxWidth: 760, minHeight: 560, idealHeight: 800)
        #endif
    }

    private var displayedCard: PricedCard? {
        guard let currencyState else { return card }
        let matches = search.results.filter { $0.display?.preferredCurrency == currencyState.preferredCurrency }
        return matches.first { $0.id == card.id }
            ?? matches.first {
                $0.game == card.game && $0.name == card.name && $0.cardNumber == card.cardNumber
                    && $0.setName == card.setName
            }
    }
}
