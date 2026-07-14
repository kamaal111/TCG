//
//  TCGAuthValidatorTests.swift
//  TCGFeatures
//
//  Created by Codex on 7/14/26.
//

import Testing

@testable import TCGAuth

@Suite("TCGAuth Validator Tests")
struct TCGAuthValidatorTests {
    @Test
    func `Should accept an email matching the server email rule`() {
        #expect(TCGAuthValidator.emailIssue("jane.doe+cards@example.co.uk") == nil)
    }

    @Test(arguments: ["invalid", ".jane@example.com", "jane..doe@example.com", "jane@example.c"])
    func `Should reject emails that fail the server email rule`(_ email: String) {
        #expect(TCGAuthValidator.emailIssue(email)?.field == .email)
    }

    @Test
    func `Should accept passwords at both server boundaries`() {
        #expect(TCGAuthValidator.passwordIssue(String(repeating: "a", count: 8)) == nil)
        #expect(TCGAuthValidator.passwordIssue(String(repeating: "a", count: 128)) == nil)
    }

    @Test
    func `Should reject a seven-character password`() {
        #expect(
            TCGAuthValidator.passwordIssue(String(repeating: "a", count: 7))?.message
                == "Password must contain at least 8 characters."
        )
    }

    @Test
    func `Should reject a 129-character password`() {
        #expect(
            TCGAuthValidator.passwordIssue(String(repeating: "a", count: 129))?.message
                == "Password must contain at most 128 characters."
        )
    }

    @Test
    func `Should accept names in any writing system that meet the spacing rules`() {
        #expect(TCGAuthValidator.nameIssue("Jane Doe") == nil)
        #expect(TCGAuthValidator.nameIssue("Мария Иванова") == nil)
        #expect(TCGAuthValidator.nameIssue("李 小龙") == nil)
    }

    @Test
    func `Should reject a name shorter than three characters`() {
        #expect(TCGAuthValidator.nameIssue("Al")?.field == .name)
    }

    @Test
    func `Should reject a single-word name`() {
        #expect(TCGAuthValidator.nameIssue("Prince")?.field == .name)
    }

    @Test(arguments: [" Jane Doe", "Jane Doe "])
    func `Should reject surrounding name whitespace`(_ name: String) {
        #expect(TCGAuthValidator.nameIssue(name)?.message == "Name must not have leading or trailing spaces.")
    }

    @Test
    func `Should reject multiple spaces between name words`() {
        #expect(TCGAuthValidator.nameIssue("Jane  Doe")?.field == .name)
    }

}
