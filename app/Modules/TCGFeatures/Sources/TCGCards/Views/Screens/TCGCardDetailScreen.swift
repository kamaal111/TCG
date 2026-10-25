import SwiftUI
import TCGCardDetails
import TCGClient
import TCGCurrency
import TCGDesignSystem

struct TCGCardDetailScreen: View {
    @Environment(\.isEditingCollection) private var isEditingCollection
    @Environment(TCGCards.self) private var cards
    @Environment(\.dismiss) private var dismiss
    @Environment(\.tcgCurrency) private var currencyState
    @State private var model: TCGCardDetailScreenModel

    init(model: TCGCardDetailScreenModel) {
        _model = State(initialValue: model)
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button(action: requestDismissal) {
                    Image(systemName: "xmark")
                }
                .accessibilityLabel(Text("Close", bundle: .module))
                .keyboardShortcut(.cancelAction)
                Spacer()
                Text("Card details", bundle: .module).font(.headline)
                Spacer()
                if isEditingCollection {
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
            if isEditingCollection, let editor = model.editor {
                editorContent(editor)
            } else if let displayedCard {
                CardDetailContent(metadata: .init(ownedCard: displayedCard), price: displayedCard.price.price) {
                    collectionDetails(displayedCard)
                }
            } else if cards.isLoading {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                VStack(spacing: 12) {
                    Text("Couldn’t load price", bundle: .module)
                    Button {
                        Task { await cards.refresh() }
                    } label: {
                        Text("Try again", bundle: .module)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(.background)
        .onChange(of: cards.cards) { _, updated in
            if let card = updated.first(where: { $0.card.id == model.card.card.id }) {
                model.replaceDisplay(with: card)
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

    private var displayedCard: CardWithPrice? {
        guard let currencyState else { return model.card }
        return cards.cards.first {
            $0.card.id == model.card.card.id && $0.card.displayCurrency == currencyState.preferredCurrency
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
            if let notes = displayedCard.card.notes, !notes.isEmpty {
                Text("Notes", bundle: .module).font(.headline)
                Text(notes)
            }
            if displayedCard.price.price == nil {
                Text("Pricing", bundle: .module).font(.title2.bold())
                CardPriceView(price: displayedCard.price)
            }
        }
    }

    private func editOrSave() {
        guard isEditingCollection else { return }
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
