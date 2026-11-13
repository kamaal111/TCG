import SwiftUI
import TCGCardDetails
import TCGClient
import TCGCurrency
import TCGDesignSystem

struct TCGSearchDetailView<AddForm: View>: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.tcgCurrency) private var currencyState
    @Environment(TCGSearch.self) private var search
    @State private var cardToAdd: PricedCard?
    @State private var didAddCard = false

    private let card: PricedCard
    private let addForm: (PricedCard, @escaping () -> Void) -> AddForm

    init(card: PricedCard, addForm: @escaping (PricedCard, @escaping () -> Void) -> AddForm) {
        self.card = card
        self.addForm = addForm
    }

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
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            Divider()
            addButton
        }
        .background(.background)
        #if os(macOS)
            .frame(minWidth: 480, idealWidth: 600, maxWidth: 760, minHeight: 560, idealHeight: 800)
        #endif
        .sheet(item: $cardToAdd, onDismiss: addFormDismissed) { card in
            addForm(card) { didAddCard = true }
        }
    }

    private var addButton: some View {
        HStack {
            Spacer()
            Button {
                cardToAdd = displayedCard ?? card
            } label: {
                Label {
                    Text("Add", bundle: .module)
                } icon: {
                    Image(systemName: "plus")
                }
            }
            .buttonStyle(.borderedProminent)
            .accessibilityLabel(Text("Add \(card.name) to collection", bundle: .module))
        }
        .padding()
    }

    private func addFormDismissed() {
        guard didAddCard else { return }
        didAddCard = false
        dismiss()
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
