//
//  AuthFieldValidatorsTests.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/14/26.
//

import Testing

@testable import TCGAuth

@Suite("AuthFieldValidators Tests")
struct AuthFieldValidatorsTests {
    @Test(arguments: [
        "john.doe@example.com",
        "a_b+c@x.co",
        "jane-doe@sub.example.org",
        "JANE'doe@EXAMPLE.COM",
    ])
    func `Should accept valid email addresses`(email: String) {
        #expect(AuthFieldValidators.validateEmail(email) == nil)
    }

    @Test(arguments: [
        "",
        "plainaddress",
        ".john@example.com",
        "a..b@x.com",
        "a.@x.com",
        "a@b",
        "a@b.c",
        "a@-b.com",
        "john doe@example.com",
        "john@example.com ",
    ])
    func `Should reject invalid email addresses`(email: String) {
        #expect(AuthFieldValidators.validateEmail(email) != nil)
    }

    @Test(arguments: [
        String(repeating: "a", count: 8),
        String(repeating: "a", count: 128),
    ])
    func `Should accept passwords within the allowed length`(password: String) {
        #expect(AuthFieldValidators.validatePassword(password) == nil)
    }

    @Test
    func `Should reject a password shorter than 8 characters`() {
        let message = AuthFieldValidators.validatePassword(String(repeating: "a", count: 7))

        #expect(message == "Password must be at least 8 characters")
    }

    @Test
    func `Should reject a password longer than 128 characters`() {
        let message = AuthFieldValidators.validatePassword(String(repeating: "a", count: 129))

        #expect(message == "Password must be at most 128 characters")
    }

    @Test(arguments: [
        "John Doe",
        "John van Doe",
        "John D0e",
        "Jo Do",
    ])
    func `Should accept valid names`(name: String) {
        #expect(AuthFieldValidators.validateName(name) == nil)
    }

    @Test(arguments: [
        ("Jo", "Name must be at least 3 characters"),
        (" John Doe", "Name must not have leading or trailing spaces"),
        ("John Doe ", "Name must not have leading or trailing spaces"),
        ("John", "Name must contain at least 2 words separated by single spaces"),
        ("John  Doe", "Name must contain at least 2 words separated by single spaces"),
        ("12 34", "Each word must contain at least one letter"),
    ])
    func `Should reject invalid names with the matching rule message`(name: String, expectedMessage: String) {
        #expect(AuthFieldValidators.validateName(name) == expectedMessage)
    }
}
