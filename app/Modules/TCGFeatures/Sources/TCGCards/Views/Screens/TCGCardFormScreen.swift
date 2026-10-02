//
//  TCGCardFormScreen.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/20/26.
//

import SwiftUI
import TCGClient
import TCGDesignSystem
import TCGModels

public struct TCGCardFormScreen: View {
    @Environment(TCGCards.self) private var cards
    @Environment(\.dismiss) private var dismiss

    @State private var model: TCGCardFormScreenModel

    public init(pricedCard: PricedCard) {
        _model = State(initialValue: TCGCardFormScreenModel(mode: .add, initialValues: .init(pricedCard: pricedCard)))
    }

    init(model: TCGCardFormScreenModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        formContent
            .navigationTitle(model.mode.title)
            .confirmationDialog(
                Text("Discard changes?", bundle: .module),
                isPresented: $model.isShowingDiscardConfirmation,
                titleVisibility: .visible
            ) {
                Button(role: .destructive) {
                    dismiss()
                } label: {
                    Text("Discard Changes", bundle: .module)
                }
                Button(role: .cancel) {
                    model.keepEditing()
                } label: {
                    Text("Keep Editing", bundle: .module)
                }
            }
            .interactiveDismissDisabled(model.hasUnsavedChanges || model.isSubmitting)
            #if os(iOS)
                .background {
                    TCGCardFormDismissalObserver(
                        isDismissalDisabled: model.hasUnsavedChanges || model.isSubmitting,
                        onAttempt: requestDismissal
                    )
                    .frame(width: 0, height: 0)
                }
            #endif
            .disabled(model.isSubmitting)
    }

    @ViewBuilder
    private var formContent: some View {
        #if os(macOS)
            VStack(spacing: 0) {
                HStack {
                    dismissButton
                    Spacer()
                }
                .overlay {
                    Text(model.mode.title)
                        .font(.headline)
                        .allowsHitTesting(false)
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 12)
                .background(Color(nsColor: .windowBackgroundColor))

                Divider()
                formScrollView
            }
        #else
            formScrollView
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { dismissButton }
                }
        #endif
    }

    private var formScrollView: some View {
        ScrollView {
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
    }

    private var dismissButton: some View {
        Button(action: requestDismissal) {
            Image(systemName: "xmark")
                .foregroundStyle(.primary)
        }
        .accessibilityLabel(Text("Close", bundle: .module))
        .tint(.primary)
        .keyboardShortcut(.cancelAction)
        .disabled(model.isSubmitting)
    }

    private func requestDismissal() {
        if model.requestDismissal() { dismiss() }
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
