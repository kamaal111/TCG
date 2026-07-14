//
//  TCGAuthSignInScreenModel.swift
//  TCGFeatures
//
//  Created by Codex on 7/14/26.
//

import Foundation
import Observation

@MainActor
@Observable
final class TCGAuthSignInScreenModel {
    var mode = Mode.login {
        didSet {
            guard mode != oldValue else { return }
            fieldErrors = [:]
            dismissToast()
        }
    }
    var name = "" {
        didSet { revalidateIfNeeded(.name) }
    }
    var email = "" {
        didSet { revalidateIfNeeded(.email) }
    }
    var password = "" {
        didSet { revalidateIfNeeded(.password) }
    }

    private(set) var fieldErrors: [TCGAuthValidationField: String] = [:]
    private(set) var isSubmitting = false
    private(set) var toast: Toast?

    @ObservationIgnored
    private var toastDismissalTask: Task<Void, Never>?

    func validate(_ field: TCGAuthValidationField) {
        guard mode == .signUp || field != .name else {
            fieldErrors[.name] = nil
            return
        }

        fieldErrors[field] = validationIssue(for: field)?.message
    }

    func submit(using auth: TCGAuth) async {
        guard !isSubmitting else { return }

        let validationIssues = validationIssues()
        if !validationIssues.isEmpty {
            applyFieldErrors(from: validationIssues)
            showErrorToast(message: TCGAuthOperationError.validation(validationIssues).errorDescription)
            return
        }

        isSubmitting = true
        defer { isSubmitting = false }

        let result: Result<Void, TCGAuthOperationError>
        switch mode {
        case .login:
            result = await auth.signIn(email: email, password: password)
        case .signUp:
            result = await auth.signUp(name: name, email: email, password: password)
        }

        switch result {
        case .failure(let error):
            if case .validation(let issues) = error {
                applyFieldErrors(from: issues)
            }
            showErrorToast(message: error.errorDescription)
        case .success:
            dismissToast()
        }
    }

    func dismissToast() {
        toastDismissalTask?.cancel()
        toastDismissalTask = nil
        toast = nil
    }

    private func validationIssues() -> [TCGAuthValidationIssue] {
        switch mode {
        case .login:
            TCGAuthValidator.signInIssues(email: email, password: password)
        case .signUp:
            TCGAuthValidator.signUpIssues(name: name, email: email, password: password)
        }
    }

    private func validationIssue(for field: TCGAuthValidationField) -> TCGAuthValidationIssue? {
        switch field {
        case .email: TCGAuthValidator.emailIssue(email)
        case .password: TCGAuthValidator.passwordIssue(password)
        case .name: TCGAuthValidator.nameIssue(name)
        }
    }

    private func revalidateIfNeeded(_ field: TCGAuthValidationField) {
        guard fieldErrors[field] != nil else { return }
        validate(field)
    }

    private func applyFieldErrors(from issues: [TCGAuthValidationIssue]) {
        fieldErrors = Dictionary(issues.map { ($0.field, $0.message) }, uniquingKeysWith: { first, _ in first })
    }

    private func showErrorToast(message: String) {
        toastDismissalTask?.cancel()
        toast = Toast(title: String(localized: "Authentication failed"), message: message)
        toastDismissalTask = Task {
            try? await Task.sleep(for: ModuleConfig.toastDismissalDelay)
            guard !Task.isCancelled else { return }
            toast = nil
        }
    }

    enum Mode: String, CaseIterable, Identifiable {
        case login
        case signUp

        var id: Self { self }

        var title: String {
            switch self {
            case .login: String(localized: "Login")
            case .signUp: String(localized: "Sign Up")
            }
        }
    }

    struct Toast: Equatable {
        let title: String
        let message: String
    }
}
