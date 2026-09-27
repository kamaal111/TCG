//
//  AppVersionTests.swift
//  TCGFeatures
//

import Testing

@testable import TCGSettings

@Suite("AppVersion Tests")
struct AppVersionTests {
    @Test
    func `Shows the marketing version with the build number`() {
        #expect(AppVersion(marketing: "1.0", build: "1").displayText == "1.0 (1)")
    }

    @Test
    func `Shows only the marketing version when the build number is missing`() {
        #expect(AppVersion(marketing: "1.0", build: nil).displayText == "1.0")
    }

    @Test
    func `Hides the version when the marketing version is missing`() {
        #expect(AppVersion(marketing: nil, build: "1").displayText == nil)
    }
}
