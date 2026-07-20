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

    init(mode: TCGCardFormScreenModel.Mode) {
        self.init(model: TCGCardFormScreenModel(mode: mode))
    }

    init(model: TCGCardFormScreenModel) {
        _model = State(initialValue: model)
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                VStack(spacing: 16) {
                    Picker("Game", selection: $model.game) {
                        ForEach(CardGame.allCases, id: \.self) { game in
                            Text(game.title).tag(game)
                        }
                    }
                    .pickerStyle(.segmented)

                    TCGFormField(label: "Name", error: model.fieldErrors[.name]) {
                        TextField("Monkey D. Luffy", text: $model.name)
                    }

                    TCGFormField(label: "Set name", error: model.fieldErrors[.setName]) {
                        TextField("Romance Dawn", text: $model.setName)
                    }

                    TCGFormField(label: "Card number", error: model.fieldErrors[.cardNumber]) {
                        TextField("OP01-003", text: $model.cardNumber)
                    }
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("Quantities")
                        .font(.headline)
                    if let quantitiesError = model.fieldErrors[.quantities] {
                        Text(quantitiesError)
                            .font(.caption)
                            .foregroundStyle(.red)
                            .accessibilityLabel("Error: \(quantitiesError)")
                    }
                    ForEach(CardCondition.allCases, id: \.self) { condition in
                        Stepper(
                            value: Binding(
                                get: { model.quantity(for: condition) },
                                set: { quantity in model.setQuantity(quantity, for: condition) }
                            ),
                            in: 0...999
                        ) {
                            HStack {
                                Text(condition.title)
                                Spacer()
                                Text("\(model.quantity(for: condition))")
                                    .font(.body.monospacedDigit())
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }

                TCGFormField(label: "Notes", error: model.fieldErrors[.notes]) {
                    TextField("Optional notes", text: $model.notes, axis: .vertical)
                        .lineLimit(3...6)
                }

                TCGSubmitButton(title: model.title, isLoading: model.isSubmitting, action: submit)
            }
            .frame(maxWidth: 420)
            .padding(32)
            .frame(maxWidth: .infinity)
        }
        .navigationTitle(Text(model.title))
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel", action: { dismiss() })
            }
        }
        .disabled(model.isSubmitting)
        .toast(
            isPresented: Binding(
                get: { model.toast != nil },
                set: { isPresented in
                    if !isPresented {
                        model.dismissToast()
                    }
                }
            ),
            style: .bottom(
                title: model.toast?.title ?? "",
                type: .error,
                description: model.toast?.message
            )
        )
    }

    private func submit() {
        Task {
            let succeeded = await model.submit(using: cards)
            if succeeded {
                dismiss()
            }
        }
    }
}
