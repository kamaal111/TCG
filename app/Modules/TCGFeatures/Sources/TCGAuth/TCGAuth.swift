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

private let logger = KamaalLogger(from: TCGAuth.self)

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

    func signIn(email: String, password: String) async -> Result<Void, TCGAuthOperationError> {
        let validationIssues = TCGAuthValidator.signInIssues(email: email, password: password)
        guard validationIssues.isEmpty else { return .failure(.validation(validationIssues)) }

        let result = await client.auth.signIn(with: SignInPayload(email: email, password: password))
        switch result {
        case .failure(.badRequest(let validations)):
            guard !validations.isEmpty else { return .failure(.invalidCredentials) }
            return .failure(.validation(mapValidationIssues(validations)))
        case .failure(.sessionUnavailable):
            return .failure(.sessionUnavailable)
        case .failure(.credentialsUnavailable(let cause)):
            return handleCredentialsUnavailable(operation: "Sign in", cause: cause)
        case .failure(.unknown):
            return handleUnknownAuthError(operation: "Sign in")
        case .success:
            return await completeAuthSuccess(operation: "Sign in")
        }
    }

    func signUp(name: String, email: String, password: String) async -> Result<Void, TCGAuthOperationError> {
        let validationIssues = TCGAuthValidator.signUpIssues(name: name, email: email, password: password)
        guard validationIssues.isEmpty else { return .failure(.validation(validationIssues)) }

        let result = await client.auth.signUp(with: SignUpPayload(name: name, email: email, password: password))
        switch result {
        case .failure(.badRequest(let validations)):
            return .failure(.validation(mapValidationIssues(validations)))
        case .failure(.conflict):
            return .failure(.emailAlreadyInUse)
        case .failure(.sessionUnavailable):
            return .failure(.sessionUnavailable)
        case .failure(.credentialsUnavailable(let cause)):
            return handleCredentialsUnavailable(operation: "Account creation", cause: cause)
        case .failure(.unknown):
            return handleUnknownAuthError(operation: "Account creation")
        case .success:
            return await completeAuthSuccess(operation: "Account creation")
        }
    }

    @discardableResult
    private func loadSession(allowCachedSession: Bool = true) async -> Result<Void, TCGAuthFeatureSessionError> {
        if allowCachedSession, let cachedSession = getCachedSessionIfLoadedToday() {
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
                    logger.error("Couldn't load the authenticated session from the server.")
                    return .serverUnavailable(context: $0)
                }
            }
        let session: UserSession
        switch result {
        case .failure(let failure):
            logger.warning("Couldn't load the authenticated session.")
            return .failure(failure)
        case .success(let success): session = success
        }

        setSession(session)
        logger.info("Loaded the authenticated session.")

        return .success(())
    }

    private func loadAuthenticatedSession() async -> Result<Void, TCGAuthOperationError> {
        switch await loadSession(allowCachedSession: false) {
        case .failure(.serverUnavailable):
            return .failure(.serverUnavailable)
        case .failure(.unauthorized):
            return .failure(.sessionUnavailable)
        case .success:
            return .success(())
        }
    }

    private func completeAuthSuccess(operation: String) async -> Result<Void, TCGAuthOperationError> {
        logger.info("\(operation) completed; loading the new session.")
        return await loadAuthenticatedSession()
    }

    private func handleCredentialsUnavailable(operation: String, cause: Error) -> Result<Void, TCGAuthOperationError> {
        logger.error(label: "\(operation) details could not be saved", error: cause)
        return .failure(.credentialsUnavailable)
    }

    private func handleUnknownAuthError(operation: String) -> Result<Void, TCGAuthOperationError> {
        logger.error("\(operation) failed while communicating with the server.")
        return .failure(.serverUnavailable)
    }

    private func mapValidationIssues(_ issues: [TCGClientValidationIssue]) -> [TCGAuthValidationIssue] {
        issues.compactMap { issue in
            guard let path = issue.path.last else { return nil }
            guard let field = TCGAuthValidationField(rawValue: path) else { return nil }
            return TCGAuthValidationIssue(field: field, message: issue.message)
        }
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
