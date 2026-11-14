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
    public let currency: TCGCurrencyClient
    public let auth: KamaalAuthClient
    public let collections: TCGCollectionsClient
    public let cards: TCGCardsClient
    public let pricing: TCGPricingClient
    public let offlineCollection: TCGOfflineCollectionClient?

    private let credentialsKeychainKey: String
    private let credentialsStore: CredentialsStore

    private init(
        currency: TCGCurrencyClient,
        auth: KamaalAuthClient,
        cards: TCGCardsClient,
        collections: TCGCollectionsClient,
        pricing: TCGPricingClient,
        credentialsKeychainKey: String,
        credentialsStore: CredentialsStore,
        offlineCollection: TCGOfflineCollectionClient?
    ) {
        self.currency = currency
        self.auth = auth
        self.cards = cards
        self.collections = collections
        self.pricing = pricing
        self.offlineCollection = offlineCollection
        self.credentialsKeychainKey = credentialsKeychainKey
        self.credentialsStore = credentialsStore
    }

    public static let sessionRejected = Notification.Name("TCGClientSessionRejected")

    public var hasValidCredentials: Bool {
        auth.hasValidCredentials
    }

    public var hasFreshAuthToken: Bool {
        guard let credentials = try? credentialsStore.credentials(forKey: credentialsKeychainKey) else { return false }
        return !credentials.sessionHasExpired && !credentials.shouldUpdateSession
            && !credentials.authTokenWillExpireSoon()
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
        let credentialsKeychainKey = "\(ModuleConfig.identifier).preview.credentials"
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
            currency: PreviewTCGCurrencyClient(),
            auth: auth,
            cards: cards,
            collections: PreviewTCGCollectionsClient(cards: cards),
            pricing: pricing,
            credentialsKeychainKey: credentialsKeychainKey,
            credentialsStore: credentialsStore,
            offlineCollection: nil
        )
    }

    static func `default`(transport: ClientTransport) -> TCGClient {
        `default`(server: serverConfiguration, transport: transport, credentialsStore: KeychainCredentialsStore())
    }

    static func `default`(
        server: ServerConfiguration,
        transport: ClientTransport,
        credentialsStore: any CredentialsStore
    ) -> TCGClient {
        let namespace = ModuleConfig.storageNamespace(server: server, bundleIdentifier: ModuleConfig.bundleIdentifier)
        return `default`(
            server: server,
            transport: transport,
            credentialsKeychainKey: "\(namespace).TCGClient.credentials",
            credentialsStore: credentialsStore
        )
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
        `default`(
            server: serverConfiguration,
            transport: transport,
            credentialsKeychainKey: credentialsKeychainKey,
            credentialsStore: credentialsStore
        )
    }

    static func `default`(
        server: ServerConfiguration,
        transport: ClientTransport,
        credentialsKeychainKey: String,
        credentialsStore: any CredentialsStore
    ) -> TCGClient {
        let tokenClient = Client(
            serverURL: server.url,
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
            serverURL: server.url,
            configuration: configuration,
            transport: transport,
            middlewares: [
                RequestDiagnosticsMiddleware(),
                AuthorizationMiddleware(tokenProvider: tokenProvider),
                OfflineManifestETagMiddleware(),
            ]
        )
        let auth = KamaalAuthClientImpl(
            hooks: TCGAuthRequestHooks(client: client, tokenClient: tokenClient),
            tokenProvider: tokenProvider,
        )
        let cards = TCGCardsClientImpl(client: client)
        let pricing = TCGPricingClientImpl(client: client)

        return TCGClient(
            currency: TCGCurrencyClientImpl(client: client),
            auth: auth,
            cards: cards,
            collections: TCGCollectionsClientImpl(client: client),
            pricing: pricing,
            credentialsKeychainKey: credentialsKeychainKey,
            credentialsStore: credentialsStore,
            offlineCollection: TCGOfflineCollectionClient(client: client)
        )
    }

    /// Session storage belongs to the same app and server as the network client's credentials.
    public static var authenticationStorageNamespace: String {
        "\(ModuleConfig.storageNamespace(server: serverConfiguration, bundleIdentifier: ModuleConfig.bundleIdentifier)).TCGAuth"
    }

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

    private static let serverConfiguration: ServerConfiguration = {
        do {
            return try ServerConfiguration(
                baseURL: Bundle.main.object(forInfoDictionaryKey: "TCGAPIBaseURL") as? String,
                environment: Bundle.main.object(forInfoDictionaryKey: "TCGAPIEnvironment") as? String
            )
        } catch {
            fatalError("Failed to configure the app server: \(error)")
        }
    }()
}
