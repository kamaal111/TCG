//
//  ExpirableTests.swift
//  TCGUtils
//
//  Created by Kamaal M Farah on 7/12/26.
//

import Foundation
import Testing

@testable import TCGUtils

@Suite("Expirable Tests")
struct ExpirableTests {
    @Test
    func `Should report hasExpired as true when expiresAt is in the past`() {
        let value = StubExpirable(expiresAt: Date.now.addingTimeInterval(-60))

        #expect(value.hasExpired)
    }

    @Test
    func `Should report hasExpired as false when expiresAt is in the future`() {
        let value = StubExpirable(expiresAt: Date.now.addingTimeInterval(60))

        #expect(!value.hasExpired)
    }

    @Test
    func `Should report willExpireSoon as true when expiresAt falls within the given interval`() {
        let value = StubExpirable(expiresAt: Date.now.addingTimeInterval(30))

        #expect(value.willExpireSoon(within: 60))
    }

    @Test
    func `Should report willExpireSoon as false when expiresAt falls outside the given interval`() {
        let value = StubExpirable(expiresAt: Date.now.addingTimeInterval(120))

        #expect(!value.willExpireSoon(within: 60))
    }

    @Test
    func `Should use a one hour default interval for willExpireSoon`() {
        let justInside = StubExpirable(expiresAt: Date.now.addingTimeInterval(3500))
        let justOutside = StubExpirable(expiresAt: Date.now.addingTimeInterval(3700))

        #expect(justInside.willExpireSoon())
        #expect(!justOutside.willExpireSoon())
    }
}

private struct StubExpirable: Expirable {
    let expiresAt: Date
}
