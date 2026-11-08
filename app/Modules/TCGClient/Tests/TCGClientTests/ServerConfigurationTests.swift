import Foundation
import HTTPTypes
import KamaalAuth
import OpenAPIRuntime
import Testing

@testable import TCGClient

@Suite("Server configuration")
struct ServerConfigurationTests {
    @Test
    func `Standalone package consumers retain localhost`() throws {
        let configuration = try ServerConfiguration(baseURL: nil, environment: nil)

        #expect(configuration.url.absoluteString == "http://localhost:8080")
    }

    @Test
    func `Remote configuration normalizes the origin for login storage`() throws {
        let configuration = try ServerConfiguration(baseURL: "https://API.EXAMPLE.COM:443/", environment: "remote")

        #expect(configuration.url.absoluteString == "https://api.example.com/")
        #expect(configuration.origin == "https://api.example.com:443")
    }

    @Test
    func `Local configuration retains its development port`() throws {
        let configuration = try ServerConfiguration(baseURL: "http://localhost:8080", environment: "local")

        #expect(configuration.url.absoluteString == "http://localhost:8080")
        #expect(configuration.origin == "http://localhost:8080")
    }

    @Test(arguments: [
        "", "https://", "$(TCG_API_SCHEME)://$(TCG_API_HOST)", "http://api.example.com",
        "https://user:password@api.example.com", "https://api.example.com/api", "https://api.example.com?token=value",
        "https://api.example.com#fragment", "https://api..example.com", " https://api.example.com",
    ])
    func `Invalid remote configuration never falls back to localhost`(value: String) {
        #expect(throws: ServerConfiguration.Failure.invalidURL) {
            try ServerConfiguration(baseURL: value, environment: "remote")
        }
    }

    @Test
    func `Missing remote URL fails instead of falling back`() {
        #expect(throws: ServerConfiguration.Failure.missingURL) {
            try ServerConfiguration(baseURL: nil, environment: "remote")
        }
    }

    @Test
    func `Configured URL requires a recognized environment`() {
        #expect(throws: ServerConfiguration.Failure.invalidEnvironment) {
            try ServerConfiguration(baseURL: "https://api.example.com", environment: "production")
        }
    }

    @Test
    func `Different servers do not share authentication storage`() throws {
        let remote = try ServerConfiguration(baseURL: "https://api.example.com", environment: "remote")
        let local = try ServerConfiguration(baseURL: "http://localhost:8080", environment: "local")
        let remoteNamespace = ModuleConfig.storageNamespace(server: remote, bundleIdentifier: "io.example.TCG")
        let localNamespace = ModuleConfig.storageNamespace(server: local, bundleIdentifier: "io.example.TCG")

        #expect(remoteNamespace != localNamespace)
        #expect(remoteNamespace != "io.example.TCG")
        #expect("\(remoteNamespace).TCGClient.credentials" != "io.example.TCG.TCGClient.credentials")
        #expect("\(remoteNamespace).TCGAuth" != "io.example.TCG.TCGAuth")
    }

    @Test
    func `Equivalent HTTPS origins reuse the same namespace`() throws {
        let first = try ServerConfiguration(baseURL: "https://API.EXAMPLE.COM:443/", environment: "remote")
        let second = try ServerConfiguration(baseURL: "https://api.example.com", environment: "remote")

        #expect(
            ModuleConfig.storageNamespace(server: first, bundleIdentifier: "io.example.TCG")
                == ModuleConfig.storageNamespace(server: second, bundleIdentifier: "io.example.TCG")
        )
    }

    @Test
    func `Separate app identities have separate storage for the same server`() throws {
        let configuration = try ServerConfiguration(baseURL: "https://api.example.com", environment: "remote")

        #expect(
            ModuleConfig.storageNamespace(server: configuration, bundleIdentifier: "io.example.TCG")
                != ModuleConfig.storageNamespace(server: configuration, bundleIdentifier: "io.example.TCG.local")
        )
    }

    @Test
    func `Token refresh and application requests use the same configured URL`() async throws {
        let server = try ServerConfiguration(baseURL: "https://api.example.com", environment: "remote")
        let store = InMemoryCredentialsStore()
        let namespace = ModuleConfig.storageNamespace(
            server: server,
            bundleIdentifier: ModuleConfig.bundleIdentifier
        )
        try store.store(Self.credentials, forKey: "\(namespace).TCGClient.credentials")
        let transport = ConfigurationTransport()
        let client = TCGClient.default(server: server, transport: transport, credentialsStore: store)
        #expect(client.hasValidCredentials)

        _ = await client.auth.refreshToken()
        _ = await client.auth.signIn(with: .init(email: "jane@example.com", password: "Password123!"))
        let calls = await transport.calls

        #expect(calls.map(\.url) == [server.url, server.url])
        #expect(calls.map(\.operation) == ["get/app-api/auth/token", "post/app-api/auth/sign-in/email"])
        #expect(calls.first?.authorization == "Bearer session-token")
    }

    @Test
    func `The remote default client ignores a valid legacy localhost login`() throws {
        let server = try ServerConfiguration(baseURL: "https://api.example.com", environment: "remote")
        let store = InMemoryCredentialsStore()
        let legacyKey = "\(ModuleConfig.identifier).credentials"
        try store.store(Self.credentials, forKey: legacyKey)
        let transport = ConfigurationTransport()
        let legacy = TCGClient.default(
            server: server,
            transport: transport,
            credentialsKeychainKey: legacyKey,
            credentialsStore: store
        )
        let remote = TCGClient.default(server: server, transport: transport, credentialsStore: store)

        #expect(legacy.hasValidCredentials)
        #expect(remote.hasValidCredentials == false)
    }

    private static let credentials = Credentials(
        authToken: "auth-token",
        authTokenExpiryDate: .distantFuture,
        sessionToken: "session-token",
        sessionUpdateAge: 1800,
        lastSessionUpdate: .now,
        sessionExpiryDate: .distantFuture
    )

}

private actor ConfigurationTransport: ClientTransport {
    struct Call: Sendable {
        let url: URL
        let operation: String
        let authorization: String?
    }

    private(set) var calls: [Call] = []

    func send(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        calls.append(.init(url: baseURL, operation: operationID, authorization: request.headerFields[.authorization]))
        return (
            .init(status: .unauthorized, headerFields: [.contentType: "application/json"]),
            HTTPBody(Data(#"{"message":"Authentication failed"}"#.utf8))
        )
    }
}
