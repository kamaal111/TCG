import SwiftUI
import TCGClient
import TCGCurrency
import TCGDesignSystem
import TCGModels

struct TCGCardFormFields: View {
    @Environment(\.tcgCollections) private var collections
    @Environment(\.tcgCurrency) private var currencyState
    @Environment(TCGCards.self) private var cards
    @State private var purchaseDefaultRefreshID = 0

    @Bindable var model: TCGCardFormScreenModel
    var submitTitle: String? = nil
    var submitsOnReturn = false
    let onSubmit: () -> Void

    var body: some View {
        VStack(spacing: 18) {
            if model.canChooseCollection, let collections {
                CardCollectionField(model: model, collections: collections)
            }
            catalogIdentity
            if let error = model.fieldErrors[.printing] {
                TCGInlineError(error).font(.caption)
            }

            VStack(alignment: .leading, spacing: 10) {
                Text("Quantities").font(.headline)
                ForEach(CardCondition.allCases, id: \.self) { condition in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text(condition.title).font(.subheadline.weight(.semibold))
                            Spacer()
                            Button {
                                model.addBatch(condition: condition)
                            } label: {
                                Label {
                                    Text("Add batch", bundle: .module)
                                } icon: {
                                    Image(systemName: "plus")
                                }
                            }
                            .buttonStyle(.borderless)
                            .help(Text("Add batch", bundle: .module))
                        }
                        ForEach($model.values.batches) { $batch in
                            if batch.condition == condition {
                                PurchaseBatchFields(
                                    batch: $batch,
                                    selectCurrency: { model.selectPurchaseCurrency(id: batch.id, currency: $0) }
                                ) {
                                    model.removeBatch(id: batch.id)
                                }
                            }
                        }
                    }
                }
                if case .draft = model.mode {
                } else {
                    Text("Purchase defaults use today's average near-mint market price.", bundle: .module)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if let error = model.fieldErrors[.purchases] {
                    TCGInlineError(error).font(.caption)
                }
                if let error = model.fieldErrors[.quantities] {
                    TCGInlineError(error).font(.caption)
                }
            }

            TCGFormField(label: "Notes", error: model.fieldErrors[.notes]) {
                TextField("Optional notes", text: $model.values.notes, axis: .vertical)
                    .lineLimit(3...6)
                    .submitScope()
            }
            TCGSubmitButton(title: submitTitle ?? model.mode.title, isLoading: model.isSubmitting) {
                onSubmit()
            }
            if let toast = model.toast {
                TCGInlineError(toast).font(.caption)
            }
        }
        .frame(maxWidth: 520)
        .padding(24)
        .frame(maxWidth: .infinity)
        .onSubmit {
            if submitsOnReturn && !model.isSubmitting { onSubmit() }
        }
        .task(id: purchaseDefaultRefreshID) {
            if let currencyState, currencyState.preferenceLoaded {
                model.configureCurrency(preferred: currencyState.preferredCurrency, rates: currencyState.rates)
            }
            await model.refreshPurchaseDefault(using: cards)
        }
        .onChange(of: currencyState?.preferenceLoaded) { _, _ in purchaseDefaultRefreshID += 1 }
        .onChange(of: currencyState?.rates) { _, _ in purchaseDefaultRefreshID += 1 }
    }

    private var catalogIdentity: some View {
        let values = model.values
        return VStack(alignment: .leading, spacing: 8) {
            LabeledContent {
                Text(CardGame(client: values.game).title)
            } label: {
                Text("Game", bundle: .module)
            }
            LabeledContent {
                Text(values.name)
            } label: {
                Text("Name", bundle: .module)
            }
            if !values.setName.isEmpty {
                LabeledContent {
                    Text(values.setName)
                } label: {
                    Text("Set name", bundle: .module)
                }
            }
            LabeledContent {
                Text(values.cardNumber)
            } label: {
                Text("Card number", bundle: .module)
            }
            if let variantName = values.variantName {
                LabeledContent {
                    Text(variantName)
                } label: {
                    Text("Variant", bundle: .module)
                }
            }
            if let illustrator = values.illustrator {
                LabeledContent {
                    Text(illustrator)
                } label: {
                    Text("Illustrator", bundle: .module)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .textSelection(.enabled)
    }
}
