//
//  TCGAuthSignInScreen.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/14/26.
//

import KamaalPopUp
import SwiftUI

struct TCGAuthSignInScreen: View {
    @Environment(TCGAuth.self) private var auth

    @StateObject private var popUpManager = KPopUpManager()

    @State private var mode: Mode = .signIn
    @State private var name = ""
    @State private var email = ""
    @State private var password = ""

    @FocusState private var focusedField: FormField?

    var body: some View {
        VStack(spacing: 16) {
            if mode == .signUp {
                AuthTextField(text: $name, label: String(localized: "Name"), error: nameErrorToShow)
                    .focused($focusedField, equals: .name)
            }
            AuthTextField(text: $email, label: String(localized: "Email"), error: emailErrorToShow)
                .focused($focusedField, equals: .email)
            AuthTextField(
                text: $password,
                label: String(localized: "Password"),
                error: passwordErrorToShow,
                isSecure: true
            )
            .focused($focusedField, equals: .password)

            Button(action: submit) {
                Text(mode.submitButtonTitle)
                    .frame(maxWidth: .infinity)
            }
            .disabled(!formIsValid || auth.isAuthenticating)

            Button(action: toggleMode) {
                Text(mode.toggleButtonTitle)
                    .font(.callout)
            }
            .buttonStyle(.plain)
            .foregroundStyle(.tint)
            .disabled(auth.isAuthenticating)
        }
        .padding()
        .frame(maxWidth: 320)
        .navigationTitle(Text(mode.title))
        .withKPopUp(popUpManager)
    }

    private var formIsValid: Bool {
        let credentialsAreValid =
            AuthFieldValidators.validateEmail(email) == nil
            && AuthFieldValidators.validatePassword(password) == nil
        guard mode == .signUp else { return credentialsAreValid }

        return credentialsAreValid && AuthFieldValidators.validateName(name) == nil
    }

    private var nameErrorToShow: String? {
        errorToShow(for: .name, value: name, validator: AuthFieldValidators.validateName)
    }

    private var emailErrorToShow: String? {
        errorToShow(for: .email, value: email, validator: AuthFieldValidators.validateEmail)
    }

    private var passwordErrorToShow: String? {
        errorToShow(for: .password, value: password, validator: AuthFieldValidators.validatePassword)
    }

    private func errorToShow(
        for field: FormField,
        value: String,
        validator: (String) -> String?
    ) -> String? {
        guard focusedField != field else { return nil }
        guard !value.isEmpty else { return nil }

        return validator(value)
    }

    private func toggleMode() {
        switch mode {
        case .signIn: mode = .signUp
        case .signUp: mode = .signIn
        }
    }

    private func submit() {
        Task {
            switch mode {
            case .signIn:
                let result = await auth.signIn(email: email, password: password)
                if case .failure(let failure) = result {
                    showErrorPopUp(message: failure.errorDescription)
                }
            case .signUp:
                let result = await auth.signUp(name: name, email: email, password: password)
                if case .failure(let failure) = result {
                    showErrorPopUp(message: failure.errorDescription)
                }
            }
        }
    }

    private func showErrorPopUp(message: String?) {
        popUpManager.showPopUp(
            style: .bottom(
                title: message ?? String(localized: "Something went wrong. Please try again later."),
                type: .error,
                description: nil
            ),
            timeout: 3
        )
    }
}

private enum Mode {
    case signIn
    case signUp

    var title: String {
        switch self {
        case .signIn: String(localized: "Sign In")
        case .signUp: String(localized: "Sign Up")
        }
    }

    var submitButtonTitle: String {
        switch self {
        case .signIn: String(localized: "Sign In")
        case .signUp: String(localized: "Sign Up")
        }
    }

    var toggleButtonTitle: String {
        switch self {
        case .signIn: String(localized: "Don't have an account? Sign up")
        case .signUp: String(localized: "Already have an account? Sign in")
        }
    }
}

private enum FormField {
    case name
    case email
    case password
}

private struct AuthTextField: View {
    @Binding var text: String

    let label: String
    let error: String?
    var isSecure = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            field
                .textFieldStyle(.roundedBorder)
                .autocorrectionDisabled()
            if let error {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
    }

    private var field: some View {
        ZStack {
            if isSecure {
                SecureField(label, text: $text)
            } else {
                TextField(label, text: $text)
            }
        }
    }
}

#Preview {
    TCGAuthSignInScreen()
        .environment(TCGAuth.default())
}
