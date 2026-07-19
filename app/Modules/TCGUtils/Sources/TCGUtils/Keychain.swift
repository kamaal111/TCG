//
//  Keychain.swift
//  TCGUtils
//
//  Created by Kamaal M Farah on 7/12/26.
//

import Foundation
import Security

struct KeychainAccess {
    let add: (CFDictionary, UnsafeMutablePointer<AnyObject?>?) -> OSStatus
    let copyMatching: (CFDictionary, UnsafeMutablePointer<AnyObject?>?) -> OSStatus
    let delete: (CFDictionary) -> OSStatus
    let update: (CFDictionary, CFDictionary) -> OSStatus

    static var live: Self {
        Self(
            add: SecItemAdd,
            copyMatching: SecItemCopyMatching,
            delete: SecItemDelete,
            update: SecItemUpdate
        )
    }
}

/// Errors that can occur when setting data in the keychain.
public enum KeychainSetErrors: LocalizedError {
    /// A general error occurred with the underlying Security framework.
    case generalError(status: OSStatus)

    public var errorDescription: String? {
        switch self {
        case .generalError(let status):
            keychainErrorDescription(action: "save", status: status)
        }
    }
}

/// Errors that can occur when retrieving data from the keychain.
public enum KeychainGetErrors: LocalizedError {
    /// A general error occurred with the underlying Security framework.
    case generalError(status: OSStatus)

    public var errorDescription: String? {
        switch self {
        case .generalError(let status):
            keychainErrorDescription(action: "read", status: status)
        }
    }
}

/// Errors that can occur when deleting data from the keychain.
public enum KeychainDeleteErrors: LocalizedError {
    /// A general error occurred with the underlying Security framework.
    case generalError(status: OSStatus)

    public var errorDescription: String? {
        switch self {
        case .generalError(let status):
            keychainErrorDescription(action: "delete", status: status)
        }
    }
}

private func keychainErrorDescription(action: String, status: OSStatus) -> String {
    let systemMessage = SecCopyErrorMessageString(status, nil) as String? ?? "Unknown Security framework error"
    return "Couldn't \(action) the secure sign-in details: \(systemMessage) (OSStatus \(status))."
}

/// A utility for securely storing, retrieving, and deleting sensitive data in the system keychain.
///
/// `Keychain` provides a simple interface for working with the iOS/macOS keychain to store
/// sensitive information like passwords, tokens, and other credentials. All data is stored
/// with the accessibility level `kSecAttrAccessibleWhenUnlocked`, meaning it's only accessible
/// when the device is unlocked.
public enum Keychain {
    /// Stores data securely in the keychain for the specified key.
    ///
    /// If an item with the same key already exists, it will be updated with the new data.
    /// The data is stored with accessibility level `kSecAttrAccessibleWhenUnlocked`.
    ///
    /// - Parameters:
    ///   - data: The data to store in the keychain.
    ///   - key: A unique identifier for the keychain item.
    ///
    /// - Returns: A `Result` indicating success or failure with a `KeychainSetErrors` error.
    ///
    /// - Example:
    /// ```swift
    /// let password = "mySecurePassword".data(using: .utf8)!
    /// let result = Keychain.set(password, forKey: "user.password")
    ///
    /// switch result {
    /// case .success:
    ///     print("Password saved successfully")
    /// case .failure(let error):
    ///     print("Failed to save password: \(error)")
    /// }
    /// ```
    @discardableResult
    public static func set(_ data: Data, forKey key: String) -> Result<Void, KeychainSetErrors> {
        set(data, forKey: key, access: .live)
    }

    @discardableResult
    static func set(_ data: Data, forKey key: String, access: KeychainAccess) -> Result<Void, KeychainSetErrors> {
        let query =
            [
                kSecClass: kSecClassGenericPassword,
                kSecAttrAccount: key,
                kSecValueData: data,
                kSecAttrAccessible: kSecAttrAccessibleWhenUnlocked,
            ] as CFDictionary
        let status = access.add(query, nil)
        guard status != errSecDuplicateItem else { return update(data, forKey: key, access: access) }
        guard status == errSecSuccess else { return .failure(.generalError(status: status)) }

        return .success(())
    }

    /// Retrieves data from the keychain for the specified key.
    ///
    /// If no item exists for the given key, the method returns `nil` wrapped in a success result.
    ///
    /// - Parameter key: The unique identifier for the keychain item to retrieve.
    ///
    /// - Returns: A `Result` containing the retrieved data (or `nil` if not found), or a `KeychainGetErrors` error.
    ///
    /// - Example:
    /// ```swift
    /// let result = Keychain.get(forKey: "user.password")
    ///
    /// switch result {
    /// case .success(let data):
    ///     if let data = data, let password = String(data: data, encoding: .utf8) {
    ///         print("Retrieved password: \(password)")
    ///     } else {
    ///         print("No password found")
    ///     }
    /// case .failure(let error):
    ///     print("Failed to retrieve password: \(error)")
    /// }
    /// ```
    public static func get(forKey key: String) -> Result<Data?, KeychainGetErrors> {
        get(forKey: key, access: .live)
    }

    static func get(forKey key: String, access: KeychainAccess) -> Result<Data?, KeychainGetErrors> {
        let query =
            [
                kSecClass: kSecClassGenericPassword,
                kSecAttrAccount: key,
                kSecReturnData: true,
                kSecMatchLimit: kSecMatchLimitOne,
            ] as CFDictionary
        var dataTypeRef: AnyObject?
        let status = access.copyMatching(query, &dataTypeRef)
        guard status != errSecItemNotFound else { return .success(nil) }
        guard status == errSecSuccess else { return .failure(.generalError(status: status)) }
        guard let data = dataTypeRef as? Data else { return .success(nil) }

        return .success(data)
    }

    /// Deletes the keychain item associated with the specified key.
    ///
    /// If no item exists for the given key, the method will fail with a `KeychainDeleteErrors` error.
    ///
    /// - Parameter key: The unique identifier for the keychain item to delete.
    ///
    /// - Returns: A `Result` indicating success or failure with a `KeychainDeleteErrors` error.
    ///
    /// - Example:
    /// ```swift
    /// let result = Keychain.delete(forKey: "user.password")
    ///
    /// switch result {
    /// case .success:
    ///     print("Password deleted successfully")
    /// case .failure(let error):
    ///     print("Failed to delete password: \(error)")
    /// }
    /// ```
    @discardableResult
    public static func delete(forKey key: String) -> Result<Void, KeychainDeleteErrors> {
        delete(forKey: key, access: .live)
    }

    @discardableResult
    static func delete(forKey key: String, access: KeychainAccess) -> Result<Void, KeychainDeleteErrors> {
        let query =
            [
                kSecClass: kSecClassGenericPassword,
                kSecAttrAccount: key,
            ] as CFDictionary
        let status = access.delete(query)
        guard status == errSecSuccess else { return .failure(.generalError(status: status)) }

        return .success(())
    }

    private static func update(_ data: Data, forKey key: String, access: KeychainAccess) -> Result<
        Void, KeychainSetErrors
    > {
        let query =
            [
                kSecClass: kSecClassGenericPassword,
                kSecAttrAccount: key,
            ] as CFDictionary
        let attributes = [kSecValueData as String: data] as CFDictionary
        let status = access.update(query, attributes)
        guard status == errSecSuccess else { return .failure(.generalError(status: status)) }

        return .success(())
    }
}
