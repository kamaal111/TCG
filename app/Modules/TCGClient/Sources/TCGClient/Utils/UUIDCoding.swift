import Foundation

enum UUIDCodingError: Error, Equatable, Sendable {
    case invalidUUID(String)
}

enum UUIDCoding {
    static func decode(_ value: String) -> Result<UUID, UUIDCodingError> {
        guard let id = UUID(uuidString: value) else { return .failure(.invalidUUID(value)) }
        return .success(id)
    }

    static func decode(_ value: String?) -> Result<UUID?, UUIDCodingError> {
        guard let value else { return .success(nil) }
        return decode(value).map(Optional.some)
    }

    static func encode(_ value: UUID) -> String {
        value.uuidString.lowercased()
    }
}
