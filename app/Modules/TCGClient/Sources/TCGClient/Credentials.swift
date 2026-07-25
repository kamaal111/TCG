//
//  Credentials.swift
//  TCGClient
//
//  Created by Kamaal M Farah on 7/12/26.
//

import Foundation

public struct Credentials: Codable {
    let authToken: String
    let authTokenExpiryDate: Date
    let sessionToken: String
    let sessionUpdateAge: TimeInterval
    let lastSessionUpdate: Date
    let sessionExpiryDate: Date?

    public init(
        authToken: String,
        authTokenExpiryDate: Date,
        sessionToken: String,
        sessionUpdateAge: TimeInterval,
        lastSessionUpdate: Date,
        sessionExpiryDate: Date? = nil
    ) {
        self.authToken = authToken
        self.authTokenExpiryDate = authTokenExpiryDate
        self.sessionToken = sessionToken
        self.sessionUpdateAge = sessionUpdateAge
        self.lastSessionUpdate = lastSessionUpdate
        self.sessionExpiryDate = sessionExpiryDate
    }

    var authTokenHasExpired: Bool {
        authTokenExpiryDate <= .now
    }

    var sessionHasExpired: Bool {
        guard let sessionExpiryDate else { return false }

        return sessionExpiryDate <= .now
    }

    func authTokenWillExpireSoon(within interval: TimeInterval = 3600) -> Bool {
        authTokenExpiryDate <= .now.addingTimeInterval(interval)
    }

    func settingSessionExpiryDate(_ date: Date) -> Credentials {
        Credentials(
            authToken: authToken,
            authTokenExpiryDate: authTokenExpiryDate,
            sessionToken: sessionToken,
            sessionUpdateAge: sessionUpdateAge,
            lastSessionUpdate: lastSessionUpdate,
            sessionExpiryDate: date,
        )
    }

    var shouldUpdateSession: Bool {
        Date.now.timeIntervalSince(lastSessionUpdate) >= sessionUpdateAge
    }
}
