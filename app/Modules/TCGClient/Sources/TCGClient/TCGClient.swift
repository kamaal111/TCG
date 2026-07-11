//
//  TCGClient.swift
//  TCGClient
//
//  Created by Kamaal M Farah on 7/11/26.
//

import OpenAPIRuntime
import OpenAPIURLSession

public struct TCGClient: Sendable {
    public let auth: TCGAuthClient

    private init(auth: TCGAuthClient) {
        self.auth = auth
    }

    public static func `default`() -> TCGClient {
        `default`(transport: URLSessionTransport())
    }

    static func `default`(transport: any ClientTransport) -> TCGClient {
        `default`(transport: transport, credentialsKeychainKey: credentialsKeychainKey)
    }

    static func `default`(transport: any ClientTransport, credentialsKeychainKey: String) -> TCGClient {
        `default`(
            transport: transport,
            credentialsKeychainKey: credentialsKeychainKey,
            credentialsStore: KeychainCredentialsStore()
        )
    }

    static func `default`(
        transport: any ClientTransport,
        credentialsKeychainKey: String,
        credentialsStore: any CredentialsStore
    ) -> TCGClient {
        let client = Client(serverURL: try! Servers.Server1.url(), transport: transport)
        let auth = TCGAuthClientImpl(
            client: client,
            credentialsKeychainKey: credentialsKeychainKey,
            credentialsStore: credentialsStore
        )

        return TCGClient(auth: auth)
    }

    private static let credentialsKeychainKey = ModuleConfig.credentialsKeychainKey
}
