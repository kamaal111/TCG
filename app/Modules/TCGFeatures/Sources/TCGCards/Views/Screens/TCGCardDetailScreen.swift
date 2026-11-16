import SwiftUI
import TCGCardDetails
import TCGClient
import TCGCurrency
import TCGDesignSystem

struct TCGCardDetailScreen: View {
    @Environment(\.isEditingCollection) private var isEditingCollection
    @Environment(TCGCards.self) private var cards
    @Environment(\.tcgCollections) private var collections
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dismiss) private var dismiss
    @Environment(\.tcgCurrency) private var currencyState
    @Environment(\.tcgPricePrivacy) private var pricePrivacy
    @State private var model: TCGCardDetailScreenModel

    init(model: TCGCardDetailScreenModel) {
        _model = State(initialValue: model)
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button(action: requestDismissal) {
                    CardModalCloseIcon()
                }
                .accessibilityLabel(Text("Close", bundle: .module))
                .keyboardShortcut(.cancelAction)
                Spacer()
                Text("Card details", bundle: .module).font(.headline)
                Spacer()
                if canEditCard {
                    Button(action: editOrSave) {
                        if model.editor != nil {
                            Text("Save", bundle: .module)
                        } else {
                            Text("Edit", bundle: .module)
                        }
                    }
                }
            }
            .padding()
            Divider()
            if canEditCard, let editor = model.editor {
                editorContent(editor)
            } else {
                CardDetailContent(metadata: .init(ownedCard: displayedCard), price: displayedCard.price.price) {
                    collectionDetails(displayedCard)
                }
            }
        }
        .background(.background)
        .task(id: DetailRefreshIdentity(active: scenePhase == .active, currency: currencyState?.displayIdentity)) {
            if scenePhase == .active, !cards.isReadOnly { await refreshDetails() }
        }
        .onChange(of: cards.cards) { _, updated in
            if let card = updated.first(where: { $0.card.id == model.card.card.id }),
                card.card.updatedAt >= model.card.card.updatedAt
            {
                model.replaceDisplay(with: cards.keepingPrice(for: card, cached: displayedCard))
            }
        }
        .disabled(model.editor?.isSubmitting == true)
        .interactiveDismissDisabled(model.editor?.hasUnsavedChanges == true || model.editor?.isSubmitting == true)
        #if os(macOS)
            .frame(minWidth: 480, idealWidth: 600, maxWidth: 760, minHeight: 560, idealHeight: 800)
        #else
            .background {
                TCGCardFormDismissalObserver(
                    isDismissalDisabled: model.editor?.hasUnsavedChanges == true || model.editor?.isSubmitting == true,
                    onAttempt: requestDismissal
                )
                .frame(width: 0, height: 0)
            }
        #endif
    }

    private func editorContent(_ editor: TCGCardFormScreenModel) -> some View {
        @Bindable var editor = editor
        return ScrollView {
            TCGCardFormFields(model: editor, submitTitle: String(localized: "Save", bundle: .module)) {
                Task { await model.save(using: cards) }
            }
        }
        .confirmationDialog(
            Text("Discard changes?", bundle: .module),
            isPresented: $editor.isShowingDiscardConfirmation,
            titleVisibility: .visible
        ) {
            Button(role: .destructive) {
                dismiss()
            } label: {
                Text("Discard Changes", bundle: .module)
            }
            Button(role: .cancel) {
                editor.keepEditing()
            } label: {
                Text("Keep Editing", bundle: .module)
            }
        }
    }

    private struct DetailRefreshIdentity: Equatable {
        let active: Bool
        let currency: TCGCurrency.DisplayIdentity?
    }

    private var displayedCard: CardWithPrice {
        cards.compatibleDisplay(model.card)
    }

    private func refreshDetails() async {
        let original = model.card
        switch await cards.validateCard(original) {
        case .success(let current):
            guard !Task.isCancelled, model.card.card.updatedAt <= current.card.updatedAt else { return }

            model.replaceDisplay(with: cards.keepingPrice(for: current, cached: displayedCard))
            let refreshed = await cards.refreshedPrices(for: [model.card])
            guard !Task.isCancelled, let priced = refreshed.first,
                model.card.card.updatedAt == priced.card.updatedAt
            else { return }

            model.replaceDisplay(with: priced)
        case .failure(.notFound):
            guard !Task.isCancelled else { return }

            dismiss()
            Task {
                if let collections {
                    await collections.refresh(using: cards)
                } else {
                    await cards.refresh()
                }
            }
        case .failure: break
        }
    }

    private func collectionDetails(_ displayedCard: CardWithPrice) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            LabeledContent {
                Text(displayedCard.card.setName)
            } label: {
                Text("Set name", bundle: .module)
            }
            Text("Quantities", bundle: .module).font(.headline)
            ForEach(CardCondition.allCases, id: \.self) { condition in
                if let quantity = displayedCard.card.quantities.first(where: { $0.condition == condition }),
                    quantity.quantity > 0
                {
                    LabeledContent(condition.title, value: quantity.quantity.formatted())
                }
            }
            ForEach(Array(displayedCard.card.purchases.enumerated()), id: \.offset) { _, batch in
                HStack {
                    Text("\(batch.condition.title) ×\(batch.quantity)", bundle: .module)
                    Spacer()
                    if pricePrivacy?.hidePrices != true {
                        if let price = batch.displayPrice {
                            CurrencyAmount(
                                price.amount,
                                currency: price.currency,
                                conversionUnavailable: price.conversionUnavailable
                            )
                        } else if let amount = batch.purchasePrice, let currency = batch.currency {
                            CurrencyAmount(amount, currency: currency)
                        } else {
                            Text("Purchase price unknown", bundle: .module).foregroundStyle(.secondary)
                        }
                    }
                }
            }
            if let notes = displayedCard.card.notes, !notes.isEmpty {
                Text("Notes", bundle: .module).font(.headline)
                Text(notes)
            }
            if pricePrivacy?.hidePrices != true, displayedCard.price.price == nil {
                Text("Pricing", bundle: .module).font(.title2.bold())
                CardPriceView(price: displayedCard.price)
            }
        }
    }

    private var canEditCard: Bool {
        #if os(iOS)
            !cards.isReadOnly
        #else
            isEditingCollection
        #endif
    }

    private func editOrSave() {
        guard canEditCard else { return }
        if model.editor == nil {
            model.edit()
        } else {
            Task { await model.save(using: cards) }
        }
    }

    private func requestDismissal() {
        if model.editor?.requestDismissal() ?? true { dismiss() }
    }
}
