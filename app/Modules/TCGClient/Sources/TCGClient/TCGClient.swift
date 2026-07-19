//
//  TCGClient.swift
//  TCGClient
//
//  Created by Kamaal M Farah on 7/11/26.
//

import Foundation
import OpenAPIRuntime
import OpenAPIURLSession

public struct TCGClient: Sendable {
    public let auth: TCGAuthClient

    private let credentialsKeychainKey: String
    private let credentialsStore: CredentialsStore

    private init(auth: TCGAuthClient, credentialsKeychainKey: String, credentialsStore: CredentialsStore) {
        self.auth = auth
        self.credentialsKeychainKey = credentialsKeychainKey
        self.credentialsStore = credentialsStore
    }

    public var hasValidCredentials: Bool {
        let credentials = try? credentialsStore.credentials(forKey: credentialsKeychainKey)
        guard let credentials else { return false }

        return !credentials.hasExpired
    }

    public static func `default`() -> TCGClient {
        `default`(transport: URLSessionTransport())
    }

    /// A ``TCGClient`` for SwiftUI previews that never performs network requests or touches the Keychain.
    ///
    /// - Parameter hasValidCredentials: Seed the in-memory credentials store so the preview looks signed in.
    public static func preview(hasValidCredentials: Bool = false) -> TCGClient {
        let seed: Data?
        if hasValidCredentials {
            let credentials = Credentials(
                authToken: "preview-auth-token",
                expiryDate: .distantFuture,
                sessionToken: "preview-session-token",
                sessionUpdateAge: 1800,
                lastSessionUpdate: .now
            )
            seed = try? JSONEncoder().encode(credentials)
        } else {
            seed = nil
        }
        let credentialsStore = InMemoryCredentialsStore(seed: seed)
        let auth = PreviewTCGAuthClient(
            credentialsStore: credentialsStore,
            credentialsKeychainKey: credentialsKeychainKey
        )

        return TCGClient(
            auth: auth,
            credentialsKeychainKey: credentialsKeychainKey,
            credentialsStore: credentialsStore
        )
    }

    static func `default`(transport: ClientTransport) -> TCGClient {
        `default`(transport: transport, credentialsKeychainKey: credentialsKeychainKey)
    }

    static func `default`(transport: ClientTransport, credentialsKeychainKey: String) -> TCGClient {
        `default`(
            transport: transport,
            credentialsKeychainKey: credentialsKeychainKey,
            credentialsStore: KeychainCredentialsStore()
        )
    }

    public static func `default`(
        transport: ClientTransport,
        credentialsKeychainKey: String,
        credentialsStore: CredentialsStore
    ) -> TCGClient {
        let tokenClient = Client(
            serverURL: serverURL,
            configuration: configuration,
            transport: transport,
            middlewares: [
                SessionAuthorizationMiddleware(
                    credentialsKeychainKey: credentialsKeychainKey,
                    credentialsStore: credentialsStore,
                    tokenRefresher: nil
                )
            ]
        )
        let tokenRefresher = TokenRefresher(
            client: tokenClient,
            credentialsKeychainKey: credentialsKeychainKey,
            credentialsStore: credentialsStore
        )
        let client = Client(
            serverURL: serverURL,
            configuration: configuration,
            transport: transport,
            middlewares: [
                SessionAuthorizationMiddleware(
                    credentialsKeychainKey: credentialsKeychainKey,
                    credentialsStore: credentialsStore,
                    tokenRefresher: tokenRefresher
                )
            ]
        )
        let auth = TCGAuthClientImpl(
            client: client,
            tokenRefresher: tokenRefresher,
            credentialsKeychainKey: credentialsKeychainKey
        )

        return TCGClient(
            auth: auth,
            credentialsKeychainKey: credentialsKeychainKey,
            credentialsStore: credentialsStore
        )
    }

    private static let credentialsKeychainKey = ModuleConfig.credentialsKeychainKey

    private static let configuration = Configuration(dateTranscoder: .iso8601WithFractionalSeconds)

    private static let serverURL: URL = {
        do {
            return try Servers.Server1.url()
        } catch {
            fatalError("Failed to resolve the default server URL: \(error)")
        }
    }()
}
