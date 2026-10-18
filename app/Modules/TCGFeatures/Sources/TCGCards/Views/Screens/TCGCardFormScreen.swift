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
            #if os(iOS)
                .toolbar(.hidden, for: .navigationBar)
            #endif
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

    private var formContent: some View {
        VStack(spacing: 0) {
            HStack {
                dismissButton
                Spacer()
                submitButton
            }
            .overlay {
                Text(model.mode.title)
                    .font(.headline)
                    .allowsHitTesting(false)
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 12)
            #if os(macOS)
                .background(Color(nsColor: .windowBackgroundColor))
            #else
                .background(.background)
            #endif

            Divider()
            formScrollView
        }
    }

    private var formScrollView: some View {
        ScrollView {
            TCGCardFormFields(model: model, submitsOnReturn: true, onSubmit: submit)
        }
    }

    private var submitButton: some View {
        Button(action: submit) {
            if model.isSubmitting {
                ProgressView().controlSize(.small)
            } else {
                submitTitle
            }
        }
        #if os(iOS)
            .buttonStyle(.borderedProminent)
        #endif
        .keyboardShortcut(.defaultAction)
        .disabled(model.isSubmitting)
        .accessibilityLabel(submitTitle)
    }

    private var submitTitle: Text {
        switch model.mode {
        case .add: Text("Add", bundle: .module)
        case .edit: Text("Save", bundle: .module)
        case .draft: Text("Save Changes", bundle: .module)
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

    private func submit() {
        Task { if await model.submit(using: cards) { dismiss() } }
    }

}
