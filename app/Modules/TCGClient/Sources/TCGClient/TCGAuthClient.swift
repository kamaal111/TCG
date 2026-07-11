//
//  TCGAuthClient.swift
//  TCGClient
//
//  Created by Kamaal M Farah on 7/11/26.
//

public protocol TCGAuthClient: Sendable {
    func signUp(with payload: SignUpPayload) async -> Result<Void, SignUpErrors>
}

public struct TCGAuthClientImpl: TCGAuthClient {
    private let client: Client

    init(client: Client) {
        self.client = client
    }

    public func signUp(with payload: SignUpPayload) async -> Result<Void, SignUpErrors> {
        return .success(())
    }
}
