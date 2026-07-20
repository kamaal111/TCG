//
//  TCGCardFormScreen.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/20/26.
//

import SwiftUI
import TCGClient
import TCGDesignSystem

struct TCGCardFormScreen: View {
    @Environment(TCGCards.self) private var cards
    @Environment(\.dismiss) private var dismiss

    @State private var model: TCGCardFormScreenModel

    init(model: TCGCardFormScreenModel) {
        _model = State(initialValue: model)
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                Picker("Game", selection: $model.values.game) {
                    ForEach(CardGame.allCases, id: \.self) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented)

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
                TCGSubmitButton(title: model.mode.title, isLoading: model.isSubmitting) {
                    Task { if await model.submit(using: cards) { dismiss() } }
                }
                if let toast = model.toast {
                    Text(toast).font(.caption).foregroundStyle(.red)
                }
            }
            .frame(maxWidth: 520)
            .padding(24)
            .frame(maxWidth: .infinity)
        }
        .navigationTitle(model.mode.title)
        .disabled(model.isSubmitting)
    }

    private func quantityBinding(for condition: CardCondition) -> Binding<Int> {
        Binding(
            get: { model.values.quantities[condition] ?? 0 },
            set: { model.values.quantities[condition] = $0 }
        )
    }
}
