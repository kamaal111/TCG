//
//  AuthFieldValidators.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/14/26.
//

import Foundation

/// Mirrors the server's auth payload validation in `server/src/auth/schemas/payloads.ts`.
/// Lengths compare UTF-16 code units to match JavaScript's `String.length`.
enum AuthFieldValidators {
    private static let emailRegex = try! NSRegularExpression(
        pattern: #"^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$"#
    )
    private static let nameWordsRegex = try! NSRegularExpression(pattern: #"^[^\s]+(\s[^\s]+)+$"#)

    private static let passwordMinimumLength = 8
    private static let passwordMaximumLength = 128
    private static let nameMinimumLength = 3

    static func validateEmail(_ email: String) -> String? {
        guard wholeMatch(emailRegex, on: email) else {
            return String(localized: "Enter a valid email address")
        }

        return nil
    }

    static func validatePassword(_ password: String) -> String? {
        guard password.utf16.count >= passwordMinimumLength else {
            return String(localized: "Password must be at least 8 characters")
        }

        guard password.utf16.count <= passwordMaximumLength else {
            return String(localized: "Password must be at most 128 characters")
        }

        return nil
    }

    static func validateName(_ name: String) -> String? {
        guard name.utf16.count >= nameMinimumLength else {
            return String(localized: "Name must be at least 3 characters")
        }

        guard name == name.trimmingCharacters(in: .whitespacesAndNewlines) else {
            return String(localized: "Name must not have leading or trailing spaces")
        }

        guard wholeMatch(nameWordsRegex, on: name) else {
            return String(localized: "Name must contain at least 2 words separated by single spaces")
        }

        let words = name.split(whereSeparator: \.isWhitespace)
        guard words.allSatisfy({ word in word.contains(where: \.isASCIILetter) }) else {
            return String(localized: "Each word must contain at least one letter")
        }

        return nil
    }

    private static func wholeMatch(_ regex: NSRegularExpression, on value: String) -> Bool {
        let range = NSRange(value.startIndex..<value.endIndex, in: value)

        return regex.firstMatch(in: value, range: range) != nil
    }
}

extension Character {
    fileprivate var isASCIILetter: Bool {
        ("a"..."z").contains(self) || ("A"..."Z").contains(self)
    }
}
