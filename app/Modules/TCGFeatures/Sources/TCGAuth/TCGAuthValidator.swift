//
//  TCGAuthValidator.swift
//  TCGFeatures
//
//  Created by Codex on 7/14/26.
//

import Foundation

enum TCGAuthValidator {
    static func signInIssues(email: String, password: String) -> [TCGAuthValidationIssue] {
        [emailIssue(email), passwordIssue(password)].compactMap(\.self)
    }

    static func signUpIssues(name: String, email: String, password: String) -> [TCGAuthValidationIssue] {
        [nameIssue(name), emailIssue(email), passwordIssue(password)].compactMap(\.self)
    }

    static func verifyEmailIssue(email: String, verifyEmail: String) -> TCGAuthValidationIssue? {
        guard email == verifyEmail else {
            return TCGAuthValidationIssue(
                field: .verifyEmail,
                message: String(localized: "Email addresses do not match.")
            )
        }

        return nil
    }

    static func verifyPasswordIssue(password: String, verifyPassword: String) -> TCGAuthValidationIssue? {
        guard password == verifyPassword else {
            return TCGAuthValidationIssue(
                field: .verifyPassword,
                message: String(localized: "Passwords do not match.")
            )
        }

        return nil
    }

    static func emailIssue(_ email: String) -> TCGAuthValidationIssue? {
        guard matches(email, expression: emailExpression) else {
            return TCGAuthValidationIssue(
                field: .email,
                message: String(localized: "Enter a valid email address.")
            )
        }

        return nil
    }

    static func passwordIssue(_ password: String) -> TCGAuthValidationIssue? {
        guard password.utf16.count >= 8 else {
            return TCGAuthValidationIssue(
                field: .password,
                message: String(localized: "Password must contain at least 8 characters.")
            )
        }

        guard password.utf16.count <= 128 else {
            return TCGAuthValidationIssue(
                field: .password,
                message: String(localized: "Password must contain at most 128 characters.")
            )
        }

        return nil
    }

    static func nameIssue(_ name: String) -> TCGAuthValidationIssue? {
        guard name.utf16.count >= 3 else {
            return TCGAuthValidationIssue(
                field: .name,
                message: String(localized: "Name must contain at least 3 characters.")
            )
        }

        guard name == name.trimmingCharacters(in: .whitespacesAndNewlines) else {
            return TCGAuthValidationIssue(
                field: .name,
                message: String(localized: "Name must not have leading or trailing spaces.")
            )
        }

        guard matches(name, expression: nameExpression) else {
            return TCGAuthValidationIssue(
                field: .name,
                message: String(localized: "Enter at least 2 words separated by single spaces.")
            )
        }

        return nil
    }

    private static func matches(
        _ value: String,
        expression: NSRegularExpression,
        entireValue: Bool = true
    ) -> Bool {
        let range = NSRange(value.startIndex..<value.endIndex, in: value)
        guard let match = expression.firstMatch(in: value, range: range) else { return false }
        guard entireValue else { return true }
        return match.range == range
    }

    private static let emailExpression = compiledExpression(
        "^(?!\\.)(?!.*\\.\\.)([A-Za-z0-9_'+\\-\\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\\-]*\\.)+[A-Za-z]{2,}$"
    )
    private static let nameExpression = compiledExpression("^[^\\s]+(\\s[^\\s]+)+$")
    private static func compiledExpression(_ pattern: String) -> NSRegularExpression {
        do {
            return try NSRegularExpression(pattern: pattern)
        } catch {
            fatalError("Invalid regular expression pattern \(pattern): \(error)")
        }
    }
}
