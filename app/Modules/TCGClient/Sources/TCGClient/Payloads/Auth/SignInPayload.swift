//
//  SignInPayload.swift
//  TCGClient
//
//  Created by Kamaal M Farah on 7/12/26.
//

public struct SignInPayload: Codable, Equatable {
    public let email: String
    public let password: String
}
