//
//  Session.swift
//  TCGClient
//
//  Created by Kamaal M Farah on 7/12/26.
//

import Foundation

public struct Session: Codable, Equatable, Sendable {
    public let name: String
    public let email: String
    public let expiresAt: Date

    public init(name: String, email: String, expiresAt: Date) {
        self.name = name
        self.email = email
        self.expiresAt = expiresAt
    }
}
