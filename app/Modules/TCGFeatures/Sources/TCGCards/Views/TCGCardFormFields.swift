import SwiftUI
import TCGClient
import TCGDesignSystem
import TCGModels

struct TCGCardFormFields: View {
    @Environment(TCGCards.self) private var cards
    @FocusState private var focusedPricingField: PricingField?
    @State private var purchaseDefaultRefreshID = 0

    @Bindable var model: TCGCardFormScreenModel
    var submitTitle: String? = nil
    let onSubmit: () -> Void

    var body: some View {
        VStack(spacing: 18) {
            TCGGamePicker(selection: gameSelection)

            TCGFormField(label: "Name", error: model.fieldErrors[.name]) {
                TextField("Monkey D. Luffy", text: $model.values.name)
                    .focused($focusedPricingField, equals: .name)
                    .onSubmit { focusedPricingField = nil }
            }
            TCGFormField(label: "Set name", error: model.fieldErrors[.setName]) {
                TextField("Romance Dawn", text: $model.values.setName)
            }
            TCGFormField(label: "Card number", error: model.fieldErrors[.cardNumber]) {
                TextField("OP01-003", text: $model.values.cardNumber)
                    .focused($focusedPricingField, equals: .cardNumber)
                    .onSubmit { focusedPricingField = nil }
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
                            }.buttonStyle(.borderless)
                        }
                        ForEach($model.values.batches) { $batch in
                            if batch.condition == condition {
                                PurchaseBatchFields(batch: $batch, marketCurrency: model.values.defaultMarketCurrency) {
                                    model.removeBatch(id: batch.id)
                                }
                            }
                        }
                    }
                }
                Text("Purchase defaults use today's average near-mint market price.", bundle: .module)
                    .font(.caption).foregroundStyle(.secondary)
                if let error = model.fieldErrors[.purchases] {
                    Text(error).font(.caption).foregroundStyle(.red)
                }
                if let error = model.fieldErrors[.quantities] {
                    Text(error).font(.caption).foregroundStyle(.red)
                }
            }

            TCGFormField(label: "Notes", error: model.fieldErrors[.notes]) {
                TextField("Optional notes", text: $model.values.notes, axis: .vertical)
                    .lineLimit(3...6)
            }
            TCGSubmitButton(title: submitTitle ?? model.mode.title, isLoading: model.isSubmitting) {
                onSubmit()
            }
            if let toast = model.toast {
                Text(toast).font(.caption).foregroundStyle(.red)
            }
        }
        .frame(maxWidth: 520)
        .padding(24)
        .frame(maxWidth: .infinity)
        .task(id: purchaseDefaultRefreshID) { await model.refreshPurchaseDefault(using: cards) }
        .onChange(of: focusedPricingField) { previous, _ in
            guard previous != nil else { return }
            purchaseDefaultRefreshID += 1
        }
        .onChange(of: model.values.game) { _, _ in
            purchaseDefaultRefreshID += 1
        }
    }

    private enum PricingField: Hashable {
        case name
        case cardNumber
    }

    private var gameSelection: Binding<CardGame> {
        Binding(
            get: { CardGame(client: model.values.game) },
            set: { newValue in model.values.game = newValue.clientGame }
        )
    }

}
