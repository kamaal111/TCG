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
        let client = Client(serverURL: try! Servers.Server1.url(), transport: URLSessionTransport())
        let auth = TCGAuthClientImpl(client: client)

        return TCGClient(auth: auth)
    }
}
