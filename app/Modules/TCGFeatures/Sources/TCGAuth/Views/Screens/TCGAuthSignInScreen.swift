//
//  TCGAuthSignInScreen.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/14/26.
//

import SwiftUI
import TCGDesignSystem

struct TCGAuthSignInScreen: View {
    @Environment(TCGAuth.self) private var auth

    @State private var model = TCGAuthSignInScreenModel()

    @FocusState private var focusedField: FocusedField?

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                TCGAuthSignInHeader(mode: model.mode)

                Picker("Authentication mode", selection: $model.mode) {
                    ForEach(TCGAuthSignInScreenModel.Mode.allCases) { mode in
                        Text(mode.title).tag(mode)
                    }
                }
                .pickerStyle(.segmented)

                VStack(spacing: 16) {
                    if model.mode == .signUp {
                        TCGAuthSignInField(label: "Name", error: model.fieldErrors[.name]) {
                            TextField("Jane Doe", text: $model.name)
                                .textContentType(.name)
                                .focused($focusedField, equals: .name)
                                .submitLabel(.next)
                                .onSubmit { focusedField = .email }
                        }
                    }

                    TCGAuthSignInField(label: "Email", error: model.fieldErrors[.email]) {
                        TextField("jane@example.com", text: $model.email)
                            .textContentType(.emailAddress)
                            .authEmailInput()
                            .focused($focusedField, equals: .email)
                            .submitLabel(.next)
                            .onSubmit { focusedField = .password }
                    }

                    TCGAuthSignInField(label: "Password", error: model.fieldErrors[.password]) {
                        SecureField("8–128 characters", text: $model.password)
                            .textContentType(model.mode == .login ? .password : .newPassword)
                            .focused($focusedField, equals: .password)
                            .submitLabel(.go)
                            .onSubmit(submit)
                    }
                }

                Button(action: submit) {
                    HStack {
                        if model.isSubmitting {
                            ProgressView()
                                .controlSize(.small)
                        }
                        Text(model.mode.title)
                            .frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(model.isSubmitting)
            }
            .frame(maxWidth: 420)
            .padding(32)
            .frame(maxWidth: .infinity)
        }
        .disabled(model.isSubmitting)
        .onChange(of: focusedField) { oldValue, newValue in
            guard let oldValue else { return }
            guard oldValue != newValue else { return }
            model.validate(oldValue.validationField)
        }
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
        focusedField = nil
        Task { await model.submit(using: auth) }
    }
}

private enum FocusedField: Hashable {
    case name
    case email
    case password

    var validationField: TCGAuthValidationField {
        switch self {
        case .name: .name
        case .email: .email
        case .password: .password
        }
    }
}
