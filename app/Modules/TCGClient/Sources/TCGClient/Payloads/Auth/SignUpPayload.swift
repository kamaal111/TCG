//
//  SignUpPayload.swift
//  TCGClient
//
//  Created by Kamaal M Farah on 7/11/26.
//

public struct SignUpPayload: Codable, Equatable {
    public let name: String
    public let email: String
    public let password: String
}
