//
//  TCGClientValidationIssue.swift
//  TCGClient
//
//  Created by Kamaal M Farah on 7/11/26.
//

public struct TCGClientValidationIssue: Codable, Equatable, Sendable {
    public let code: String
    public let path: [String]
    public let message: String

    public init(code: String, path: [String], message: String) {
        self.code = code
        self.path = path
        self.message = message
    }

    public var displayPath: String? {
        guard !path.isEmpty else { return nil }
        return path.joined(separator: ".")
    }
}
