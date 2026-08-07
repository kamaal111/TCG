//
//  TCGClient.swift
//  TCGClient
//
//  Created by Kamaal M Farah on 7/11/26.
//

import Foundation
import KamaalAuth
import KamaalLogger
import OpenAPIRuntime
import OpenAPIURLSession

private let logger = KamaalLogger(from: TCGClient.self)

public struct TCGClient: Sendable {
    public let auth: KamaalAuthClient
    public let cards: TCGCardsClient
    public let pricing: TCGPricingClient

    private let credentialsKeychainKey: String
    private let credentialsStore: CredentialsStore

    private init(
        auth: KamaalAuthClient,
        cards: TCGCardsClient,
        pricing: TCGPricingClient,
        credentialsKeychainKey: String,
        credentialsStore: CredentialsStore
    ) {
        self.auth = auth
        self.cards = cards
        self.pricing = pricing
        self.credentialsKeychainKey = credentialsKeychainKey
        self.credentialsStore = credentialsStore
    }

    public var hasValidCredentials: Bool {
        auth.hasValidCredentials
    }

    public static func `default`() -> TCGClient {
        `default`(transport: URLSessionTransport())
    }

    /// A ``TCGClient`` for SwiftUI previews that never performs network requests or touches the Keychain.
    ///
    /// - Parameter hasValidCredentials: Seed the in-memory credentials store so the preview looks signed in.
    static func preview(hasValidCredentials: Bool = false) -> TCGClient {
        preview(
            hasValidCredentials: hasValidCredentials,
            authOutcome: .success,
            cardsOutcome: .success(cards: PreviewTCGCardsClient.sampleCards),
            pricingOutcome: .success
        )
    }

    static func preview(authOutcome: PreviewAuthOutcome) -> TCGClient {
        preview(
            hasValidCredentials: false,
            authOutcome: authOutcome,
            cardsOutcome: .success(cards: PreviewTCGCardsClient.sampleCards),
            pricingOutcome: .success
        )
    }

    static func preview(hasValidCredentials: Bool, authOutcome: PreviewAuthOutcome) -> TCGClient {
        preview(
            hasValidCredentials: hasValidCredentials,
            authOutcome: authOutcome,
            cardsOutcome: .success(cards: PreviewTCGCardsClient.sampleCards),
            pricingOutcome: .success
        )
    }

    static func preview(cardsOutcome: PreviewTCGCardsOutcome) -> TCGClient {
        preview(
            hasValidCredentials: true,
            authOutcome: .success,
            cardsOutcome: cardsOutcome,
            pricingOutcome: .success
        )
    }

    static func preview(pricingOutcome: PreviewTCGPricingOutcome) -> TCGClient {
        preview(
            hasValidCredentials: true,
            authOutcome: .success,
            cardsOutcome: .success(cards: PreviewTCGCardsClient.sampleCards),
            pricingOutcome: pricingOutcome
        )
    }

    static func preview(
        hasValidCredentials: Bool,
        authOutcome: PreviewAuthOutcome,
        cardsOutcome: PreviewTCGCardsOutcome,
        pricingOutcome: PreviewTCGPricingOutcome
    ) -> TCGClient {
        let credentialsStore = InMemoryCredentialsStore()
        if hasValidCredentials {
            try? credentialsStore.store(Self.previewCredentials, forKey: credentialsKeychainKey)
        }
        let auth = PreviewKamaalAuthClient(
            outcome: authOutcome,
            hasValidCredentials: hasValidCredentials,
            session: Self.previewSession,
        )
        let cards = PreviewTCGCardsClient(outcome: cardsOutcome)
        let pricing = PreviewTCGPricingClient(outcome: pricingOutcome)

        return TCGClient(
            auth: auth,
            cards: cards,
            pricing: pricing,
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
        credentialsStore: any CredentialsStore
    ) -> TCGClient {
        let tokenClient = Client(
            serverURL: serverURL,
            configuration: configuration,
            transport: transport,
            middlewares: [
                SessionTokenMiddleware(credentialsKey: credentialsKeychainKey, credentialsStore: credentialsStore)
            ]
        )
        // The provider only needs the token client, so it can be built before the client whose middleware uses it.
        // Building the authenticated client first would be circular.
        let tokenProvider = AuthTokenProvider(
            credentialsKey: credentialsKeychainKey,
            credentialsStore: credentialsStore,
        ) { await AuthTokenIssuer.issue(using: tokenClient) }
        let client = Client(
            serverURL: serverURL,
            configuration: configuration,
            transport: transport,
            middlewares: [AuthorizationMiddleware(tokenProvider: tokenProvider)]
        )
        let auth = KamaalAuthClientImpl(
            hooks: TCGAuthRequestHooks(client: client, tokenClient: tokenClient),
            tokenProvider: tokenProvider,
        )
        let cards = TCGCardsClientImpl(client: client)
        let pricing = TCGPricingClientImpl(client: client)

        return TCGClient(
            auth: auth,
            cards: cards,
            pricing: pricing,
            credentialsKeychainKey: credentialsKeychainKey,
            credentialsStore: credentialsStore
        )
    }

    private static let credentialsKeychainKey = ModuleConfig.credentialsKeychainKey

    /// Kept stable so previews and the screen snapshot baselines do not move.
    private static let previewSession = AuthSession(
        id: "preview-user",
        name: "Jane Doe",
        email: "jane@example.com",
        emailVerified: true,
        createdAt: .now,
        expiresAt: .distantFuture,
    )

    private static let previewCredentials = Credentials(
        authToken: "preview-auth-token",
        authTokenExpiryDate: .distantFuture,
        sessionToken: "preview-session-token",
        sessionUpdateAge: 1800,
        lastSessionUpdate: .now,
        sessionExpiryDate: .distantFuture,
    )

    private static let configuration = Configuration(dateTranscoder: .iso8601WithFractionalSeconds)

    private static let serverURL: URL = {
        do {
            return try Servers.Server1.url()
        } catch {
            fatalError("Failed to resolve the default server URL: \(error)")
        }
    }()
}
