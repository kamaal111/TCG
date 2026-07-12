//
//  TCGAuth.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/12/26.
//

import Observation
import TCGClient

@MainActor
@Observable
public final class TCGAuth {
    private let client: TCGClient

    private(set) var initiallyValidatingToken: Bool

    private init(client: TCGClient) {
        self.client = client
        if client.hasValidCredentials {
            initiallyValidatingToken = true
            Task {
                await loadSession()
                initiallyValidatingToken = false
            }
        } else {
            initiallyValidatingToken = false
        }
    }

    public static func `default`() -> TCGAuth {
        let client = TCGClient.default()

        return TCGAuth(client: client)
    }

    private func loadSession() async {}
}
