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
            TCGCardFormFields(model: model) {
                Task { if await model.submit(using: cards) { dismiss() } }
            }
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

}
