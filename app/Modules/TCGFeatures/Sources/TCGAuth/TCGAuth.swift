//
//  TCGAuth.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/12/26.
//

import Foundation
import KamaalLogger
import KamaalUtils
import Observation
import TCGClient

private let logger = KamaalLogger(from: TCGAuth.self, failOnError: true)

@MainActor
@Observable
public final class TCGAuth {
    private let client: TCGClient

    @ObservationIgnored
    private var cachedSessionStore: CachedUserSessionStore

    private(set) var session: UserSession?
    private(set) var initiallyValidatingToken: Bool

    init(client: TCGClient, cachedSessionStore: CachedUserSessionStore) {
        self.client = client
        self.cachedSessionStore = cachedSessionStore
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

    var isLoggedIn: Bool {
        session != nil
    }

    public static func `default`() -> TCGAuth {
        TCGAuth(client: TCGClient.default(), cachedSessionStore: UserDefaultsCachedUserSessionStore())
    }

    @discardableResult
    private func loadSession() async -> Result<Void, TCGAuthFeatureSessionError> {
        if let cachedSession = getCachedSessionIfLoadedToday() {
            setSession(cachedSession)
            return .success(())
        }

        let result: Result<UserSession, TCGAuthFeatureSessionError> = await client.auth.session()
            .map { UserSession(name: $0.name, email: $0.email, expiresAt: $0.expiresAt) }
            .mapError {
                switch $0 {
                case .unauthorized:
                    return .unauthorized(context: $0)
                case .unknown:
                    logger.error(label: "Failed to get session", error: $0)
                    return .serverUnavailable(context: $0)
                }
            }
        let session: UserSession
        switch result {
        case .failure(let failure): return .failure(failure)
        case .success(let success): session = success
        }

        setSession(session)

        return .success(())
    }

    private func setSession(_ session: UserSession) {
        self.session = session
        cachedSessionStore.cachedSession = CachedUserSession(session: session, cachedAt: .now)
    }

    private func getCachedSessionIfLoadedToday() -> UserSession? {
        guard let cachedSession = cachedSessionStore.cachedSession else { return nil }

        let calendar = Calendar.current
        let now = Date.now
        let sessionHasBeenCachedToday = calendar.isDate(cachedSession.cachedAt, inSameDayAs: now)
        guard sessionHasBeenCachedToday else { return nil }
        guard !cachedSession.session.hasExpired else { return nil }

        return cachedSession.session
    }
}

protocol CachedUserSessionStore {
    var cachedSession: CachedUserSession? { get set }
}

@MainActor
final class UserDefaultsCachedUserSessionStore: CachedUserSessionStore {
    @UserDefaultsObject(key: "\(ModuleConfig.identifier).cachedSession")
    var cachedSession: CachedUserSession?

    init() {}
}

private enum TCGAuthFeatureSessionError: Error {
    case serverUnavailable(context: Error?)
    case unauthorized(context: Error?)
}
