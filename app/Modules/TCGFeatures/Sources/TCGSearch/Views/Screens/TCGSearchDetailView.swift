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
    @State private var imageGroup: SearchResultGroup?

    private let card: PricedCard
    private let variants: [PricedCard]
    private let addForm: (PricedCard, @escaping () -> Void) -> AddForm

    init(
        card: PricedCard,
        variants: [PricedCard] = [],
        addForm: @escaping (PricedCard, @escaping () -> Void) -> AddForm
    ) {
        self.card = card
        self.variants = variants
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
            if selectedCard.imageURL == nil, let exploreVariants {
                Button(action: exploreVariants) {
                    Text("Explore variant artwork", bundle: .module)
                }
                .padding(.vertical, 8)
            }
            CardDetailContent(
                metadata: .init(card: displayedCard ?? selectedCard),
                price: displayedCard,
                onExplore: exploreVariants
            ) {
                if displayedCard == nil {
                    if search.isSearching {
                        ProgressView()
                    } else {
                        Button {
                            Task { await search.refresh() }
                        } label: {
                            Text("Search again for current prices", bundle: .module)
                        }
                    }
                }
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
        .modifier(SearchImagePresentation(group: $imageGroup))
    }

    private var addButton: some View {
        HStack {
            Spacer()
            Button {
                cardToAdd = displayedCard ?? selectedCard
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

    private var currentVariants: [PricedCard] {
        variants.map { variant in
            Self.latestCard(for: variant, in: search.results)
        }
    }

    private var selectedCard: PricedCard {
        Self.latestCard(for: card, in: search.results)
    }

    static func latestCard(for card: PricedCard, in results: [PricedCard]) -> PricedCard {
        results.first { $0.id == card.id } ?? card
    }

    private var exploreVariants: (() -> Void)? {
        let group = SearchResultGroup(card: selectedCard, variants: currentVariants)
        guard variants.count > 1, group.hasArtwork else { return nil }
        return { imageGroup = group }
    }

    private var displayedCard: PricedCard? {
        let card = selectedCard
        guard let currencyState else { return card }
        let matches = search.results.filter { $0.display?.preferredCurrency == currencyState.preferredCurrency }
        let exactMatch = matches.first { $0.id == card.id }
        if card.game == .onePiece { return exactMatch }

        return exactMatch
            ?? matches.first {
                $0.game == card.game && $0.name == card.name && $0.cardNumber == card.cardNumber
                    && $0.setName == card.setName
            }
    }
}
