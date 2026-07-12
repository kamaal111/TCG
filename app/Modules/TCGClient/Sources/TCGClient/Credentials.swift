//
//  Credentials.swift
//  TCGClient
//
//  Created by Kamaal M Farah on 7/12/26.
//

import Foundation
import TCGUtils

struct Credentials: Codable, Expirable {
    let authToken: String
    let expiryDate: Date
    let sessionToken: String
    let sessionUpdateAge: TimeInterval
    let lastSessionUpdate: Date

    var expiresAt: Date {
        expiryDate
    }

    func setExpiryDate(_ date: Date) -> Credentials {
        Credentials(
            authToken: authToken,
            expiryDate: date,
            sessionToken: sessionToken,
            sessionUpdateAge: sessionUpdateAge,
            lastSessionUpdate: lastSessionUpdate,
        )
    }

    var shouldUpdateSession: Bool {
        Date.now.timeIntervalSince(lastSessionUpdate) >= sessionUpdateAge
    }

    func updatedSession() -> Credentials {
        Credentials(
            authToken: authToken,
            expiryDate: expiryDate,
            sessionToken: sessionToken,
            sessionUpdateAge: sessionUpdateAge,
            lastSessionUpdate: Date.now,
        )
    }
}
