import SwiftUI
import TCGClient
import TCGDesignSystem
import TCGModels

struct TCGCardFormFields: View {
    @Bindable var model: TCGCardFormScreenModel
    var submitTitle: String? = nil
    let onSubmit: () -> Void

    var body: some View {
        VStack(spacing: 18) {
            TCGGamePicker(selection: gameSelection)

            TCGFormField(label: "Name", error: model.fieldErrors[.name]) {
                TextField("Monkey D. Luffy", text: $model.values.name)
            }
            TCGFormField(label: "Set name", error: model.fieldErrors[.setName]) {
                TextField("Romance Dawn", text: $model.values.setName)
            }
            TCGFormField(label: "Card number", error: model.fieldErrors[.cardNumber]) {
                TextField("OP01-003", text: $model.values.cardNumber)
            }

            VStack(alignment: .leading, spacing: 10) {
                Text("Quantities").font(.headline)
                ForEach(CardCondition.allCases, id: \.self) { condition in
                    Stepper(
                        "\(condition.title): \(model.values.quantities[condition] ?? 0)",
                        value: quantityBinding(for: condition),
                        in: 0...999
                    )
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
    }

    private var gameSelection: Binding<CardGame> {
        Binding(
            get: { CardGame(client: model.values.game) },
            set: { newValue in model.values.game = newValue.clientGame }
        )
    }

    private func quantityBinding(for condition: CardCondition) -> Binding<Int> {
        Binding(
            get: { model.values.quantities[condition] ?? 0 },
            set: { model.values.quantities[condition] = $0 }
        )
    }
}
