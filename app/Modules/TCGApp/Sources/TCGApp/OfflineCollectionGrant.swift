import Foundation
import LocalAuthentication
import Security

struct OfflineCollectionGrant {
    enum Failure: Error {
        case keychain(OSStatus)
        case unavailable
    }

    let namespace: String

    private var query: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "OfflineCollection.\(namespace)",
            kSecAttrAccount as String: "download",
            kSecUseDataProtectionKeychain as String: true,
        ]
    }

    var isAvailable: Bool { LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: nil) }

    func create(owner: String) throws {
        guard isAvailable,
            let access = SecAccessControlCreateWithFlags(
                nil,
                kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
                .userPresence,
                nil
            )
        else { throw Failure.unavailable }
        var item = query
        item[kSecAttrAccessControl as String] = access
        item[kSecValueData as String] = Data(owner.utf8)
        let result = SecItemAdd(item as CFDictionary, nil)
        guard result == errSecSuccess || result == errSecDuplicateItem else { throw Failure.keychain(result) }
    }

    func unlock(reason: String) async throws -> String {
        let context = LAContext()
        guard try await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) else {
            throw Failure.unavailable
        }
        var request = query
        request[kSecUseAuthenticationContext as String] = context
        request[kSecReturnData as String] = true
        var result: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &result)
        guard status == errSecSuccess else { throw Failure.keychain(status) }
        guard let data = result as? Data, let owner = String(data: data, encoding: .utf8) else {
            throw Failure.unavailable
        }
        return owner
    }

    func remove() throws {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw Failure.keychain(status) }
    }
}
