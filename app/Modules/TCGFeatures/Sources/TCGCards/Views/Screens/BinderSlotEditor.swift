import SwiftUI
import TCGClient
import TCGDesignSystem

struct BinderSlotEditor: View {
    @Environment(TCGCards.self) private var cards
    @Environment(\.dismiss) private var dismiss
    let collection: CardBinderCollection
    let position: BinderPosition
    let collections: TCGCollections
    @State private var availableCards: [CardWithPrice] = []
    @State private var cardID: UUID?
    @State private var quantity = 1
    @State private var error: String?
    @State private var isLoading = true
    @State private var isShowingDetails = false

    private var existing: BinderSlot? {
        collection.pages.first { $0.id == position.pageID }?.slots.first {
            $0.row == position.row && $0.column == position.column
        }
    }
    private var selectedCard: CardWithPrice? { availableCards.first { $0.card.id == cardID } }
    private var maximum: Int {
        guard let selectedCard else { return 0 }
        let total = selectedCard.card.totalQuantity
        return max(
            0,
            total - collection.allocatedCopies(of: selectedCard.card.id)
                + (existing?.cardID == selectedCard.card.id ? existing?.quantity ?? 0 : 0)
        )
    }

    private var quantityPolicy: BinderSlotQuantity { BinderSlotQuantity(maximum: maximum) }

    var body: some View {
        Form {
            if isLoading { ProgressView() }
            NavigationLink {
                BinderCardPicker(cards: availableCards, selection: $cardID)
            } label: {
                if let selectedCard {
                    BinderCardLabel(card: selectedCard)
                } else {
                    Label {
                        Text("Choose a card", bundle: .module)
                    } icon: {
                        Image(systemName: "photo.on.rectangle")
                    }
                }
            }
            .disabled(isLoading)
            .help(Text("Choose a card", bundle: .module))
            if maximum > 0 {
                Stepper(value: $quantity, in: 1...maximum) { Text("Copies in this slot: \(quantity)", bundle: .module) }
                Text("\(maximum) copies available for this slot", bundle: .module).foregroundStyle(.secondary)
            } else if !isLoading && (selectedCard != nil || availableCards.isEmpty) {
                Text(
                    "No unplaced copies available. Clear another slot or add cards to this collection.",
                    bundle: .module
                )
            }
            if selectedCard != nil {
                Button {
                    isShowingDetails = true
                } label: {
                    Text("Card details", bundle: .module)
                }
            }
            if existing != nil {
                Button(role: .destructive) {
                    Task { await save(clear: true) }
                } label: {
                    Text("Clear slot", bundle: .module)
                }
            }
            if let error { TCGInlineError(error) }
        }
        .formStyle(.grouped)
        .navigationTitle(Text("Slot contents", bundle: .module))
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button {
                    dismiss()
                } label: {
                    Text("Cancel", bundle: .module)
                }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button {
                    Task { await save(clear: false) }
                } label: {
                    Text("Save", bundle: .module)
                }
                .disabled(
                    cardID == nil || !quantityPolicy.permits(quantity) || collections.isWorking
                )
            }
        }
        .onChange(of: cardID) { quantity = quantityPolicy.clamped(quantity) }
        .task {
            guard isLoading else { return }
            switch await cards.allCardsInSelectedCollection() {
            case .success(let result): availableCards = result
            case .failure(let failure): error = failure.localizedDescription
            }
            cardID = existing?.cardID
            quantity = existing?.quantity ?? 1
            isLoading = false
        }
        .sheet(isPresented: $isShowingDetails) {
            if let selectedCard { NavigationStack { TCGCardDetailScreen(model: .init(card: selectedCard)) } }
        }
        .frame(minWidth: 300, minHeight: 300)
    }

    private func save(clear: Bool) async {
        guard clear || (cardID != nil && quantityPolicy.permits(quantity)) else { return }
        guard let index = collection.pages.firstIndex(where: { $0.id == position.pageID }) else { return }
        var updated = collection
        updated.pages[index].slots.removeAll { $0.row == position.row && $0.column == position.column }
        if !clear, let cardID {
            updated.pages[index].slots.append(
                .init(row: position.row, column: position.column, cardID: cardID, quantity: quantity)
            )
        }
        if await collections.save(updated, using: cards) {
            dismiss()
        } else {
            error = collections.error?.localizedDescription
        }
    }
}
