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

    @State private var model: TCGAuthSignInScreenModel

    @FocusState private var focusedField: FocusedField?

    init(model: TCGAuthSignInScreenModel = TCGAuthSignInScreenModel()) {
        _model = State(initialValue: model)
    }

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
                        TCGFormField(label: "Name", error: model.fieldErrors[.name]) {
                            TextField("Jane Doe", text: $model.name)
                                .textContentType(.name)
                                .focused($focusedField, equals: .name)
                                .submitLabel(.next)
                                .onSubmit { focusedField = .email }
                        }
                    }

                    TCGFormField(label: "Email", error: model.fieldErrors[.email]) {
                        TextField("jane@example.com", text: $model.email)
                            .textContentType(.emailAddress)
                            .authEmailInput()
                            .focused($focusedField, equals: .email)
                            .submitLabel(.next)
                            .onSubmit {
                                focusedField = model.mode == .signUp ? .verifyEmail : .password
                            }
                    }

                    if model.mode == .signUp {
                        TCGFormField(label: "Verify email", error: model.fieldErrors[.verifyEmail]) {
                            TextField("jane@example.com", text: $model.verifyEmail)
                                .textContentType(.emailAddress)
                                .authEmailInput()
                                .focused($focusedField, equals: .verifyEmail)
                                .submitLabel(.next)
                                .onSubmit { focusedField = .password }
                        }
                    }

                    TCGFormField(label: "Password", error: model.fieldErrors[.password]) {
                        SecureField("8–128 characters", text: $model.password)
                            .textContentType(model.mode == .login ? .password : .newPassword)
                            .focused($focusedField, equals: .password)
                            .submitLabel(model.mode == .signUp ? .next : .go)
                            .onSubmit {
                                if model.mode == .signUp {
                                    focusedField = .verifyPassword
                                } else {
                                    submit()
                                }
                            }
                    }

                    if model.mode == .signUp {
                        TCGFormField(label: "Verify password", error: model.fieldErrors[.verifyPassword]) {
                            SecureField("8–128 characters", text: $model.verifyPassword)
                                .textContentType(.newPassword)
                                .focused($focusedField, equals: .verifyPassword)
                                .submitLabel(.go)
                                .onSubmit(submit)
                        }
                    }
                }

                TCGSubmitButton(title: model.mode.title, isLoading: model.isSubmitting, action: submit)
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
    case verifyEmail
    case password
    case verifyPassword

    var validationField: TCGAuthValidationField {
        switch self {
        case .name: .name
        case .email: .email
        case .verifyEmail: .verifyEmail
        case .password: .password
        case .verifyPassword: .verifyPassword
        }
    }
}
