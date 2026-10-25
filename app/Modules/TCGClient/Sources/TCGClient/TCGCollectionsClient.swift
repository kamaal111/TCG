import Foundation
import OpenAPIRuntime

public enum CollectionsError: LocalizedError, Equatable, Sendable {
    case unauthorized
    case notFound
    case conflict
    case validation([TCGClientValidationIssue])
    case requestTooLarge
    case busy
    case timedOut
    case unavailable

    public var errorDescription: String? {
        switch self {
        case .unauthorized: String(localized: "Sign in again to manage your collections.", bundle: .module)
        case .notFound: String(localized: "This collection or card is no longer available.", bundle: .module)
        case .conflict:
            String(
                localized: "Your collection changed or there are not enough unplaced copies. Refresh and try again.",
                bundle: .module
            )
        case .validation: String(localized: "Check the collection details and try again.", bundle: .module)
        case .requestTooLarge:
            String(
                localized:
                    "This collection request exceeds the server limits. Ask your server administrator to increase them.",
                bundle: .module
            )
        case .busy:
            String(localized: "Another collection operation is in progress. Please try again shortly.", bundle: .module)
        case .timedOut:
            String(localized: "The collection operation took too long. Please try again.", bundle: .module)
        case .unavailable:
            String(localized: "Couldn’t save or load your collection. Please try again.", bundle: .module)
        }
    }
}

public protocol TCGCollectionsClient: Sendable {
    func list() async -> Result<[CardCollectionSummary], CollectionsError>

    func get(id: UUID) async -> Result<CardBinderCollection, CollectionsError>

    func create(name: String) async -> Result<CardBinderCollection, CollectionsError>

    func update(_ collection: CardBinderCollection) async -> Result<CardBinderCollection, CollectionsError>

    func save(_ collection: CardBinderCollection) async -> Result<CardBinderCollection, CollectionsError>

    func delete(id: UUID) async -> Result<Void, CollectionsError>

    func page(collectionID: UUID, pageID: UUID) async -> Result<BinderPageCards, CollectionsError>

    func export(ids: [UUID]?) async -> Result<CollectionBackup, CollectionsError>

    func preview(_ backup: CollectionBackup) async -> Result<CollectionBackupPreview, CollectionsError>

    func importBackup(_ backup: CollectionBackup) async -> Result<ImportCollectionBackupResult, CollectionsError>
}

public enum CollectionBackupCodingError: Error, Sendable {
    case encodingFailed(cause: any Error)
    case decodingFailed(cause: any Error)
}

public enum CollectionBackupCoding {
    public static func encode(_ backup: CollectionBackup) -> Result<Data, CollectionBackupCodingError> {
        let encoder = encoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        do { return .success(try encoder.encode(backup)) } catch { return .failure(.encodingFailed(cause: error)) }
    }

    public static func decode(_ data: Data) -> Result<CollectionBackup, CollectionBackupCodingError> {
        do { return .success(try decoder().decode(CollectionBackup.self, from: data)) } catch {
            return .failure(.decodingFailed(cause: error))
        }
    }

    private static func encoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, encoder in
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            var container = encoder.singleValueContainer()
            try container.encode(formatter.string(from: date))
        }
        return encoder
    }

    private static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let value = try decoder.singleValueContainer().decode(String.self)
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = formatter.date(from: value) { return date }
            formatter.formatOptions = [.withInternetDateTime]
            if let date = formatter.date(from: value) { return date }
            throw DecodingError.dataCorrupted(
                .init(codingPath: decoder.codingPath, debugDescription: "Invalid backup date")
            )
        }
        return decoder
    }
}

struct TCGCollectionsClientImpl: TCGCollectionsClient {
    let client: Client

    func list() async -> Result<[CardCollectionSummary], CollectionsError> {
        do {
            switch try await client.getAppApiCollections() {
            case .ok(let response):
                let value = try response.body.json
                return ResultMapping.map(value.collections, transform: CollectionMapper.makeSummary)
                    .mapError { _ in .unavailable }
            case .badRequest(let response):
                return .failure(.validation(TCGClientValidationErrorParser.parseIssues(from: try? response.body.json)))
            case .unauthorized: return .failure(.unauthorized)
            case .notFound: return .failure(.notFound)
            case .conflict: return .failure(.conflict)
            case .contentTooLarge: return .failure(.requestTooLarge)
            case .requestTimeout: return .failure(.timedOut)
            case .tooManyRequests: return .failure(.busy)
            case .serviceUnavailable(let response):
                return .failure(Self.serviceError(code: (try? response.body.json)?.code))
            case .internalServerError, .undocumented: return .failure(.unavailable)
            }
        } catch { return .failure(.unavailable) }
    }

    func get(id: UUID) async -> Result<CardBinderCollection, CollectionsError> {
        do {
            switch try await client.getAppApiCollectionsCollectionId(path: .init(collectionId: UUIDCoding.encode(id))) {
            case .ok(let response):
                return CollectionMapper.makeCollection(try response.body.json)
                    .mapError { _ in .unavailable }
            case .badRequest(let response):
                return .failure(.validation(TCGClientValidationErrorParser.parseIssues(from: try? response.body.json)))
            case .unauthorized: return .failure(.unauthorized)
            case .notFound: return .failure(.notFound)
            case .conflict: return .failure(.conflict)
            case .contentTooLarge: return .failure(.requestTooLarge)
            case .requestTimeout: return .failure(.timedOut)
            case .tooManyRequests: return .failure(.busy)
            case .serviceUnavailable(let response):
                return .failure(Self.serviceError(code: (try? response.body.json)?.code))
            case .internalServerError, .undocumented: return .failure(.unavailable)
            }
        } catch { return .failure(.unavailable) }
    }

    func create(name: String) async -> Result<CardBinderCollection, CollectionsError> {
        do {
            switch try await client.postAppApiCollections(body: .json(.init(name: name))) {
            case .created(let response):
                return CollectionMapper.makeCollection(try response.body.json)
                    .mapError { _ in .unavailable }
            case .badRequest(let response):
                return .failure(.validation(TCGClientValidationErrorParser.parseIssues(from: try? response.body.json)))
            case .unauthorized: return .failure(.unauthorized)
            case .notFound: return .failure(.notFound)
            case .conflict: return .failure(.conflict)
            case .contentTooLarge: return .failure(.requestTooLarge)
            case .requestTimeout: return .failure(.timedOut)
            case .tooManyRequests: return .failure(.busy)
            case .serviceUnavailable(let response):
                return .failure(Self.serviceError(code: (try? response.body.json)?.code))
            case .internalServerError, .undocumented: return .failure(.unavailable)
            }
        } catch { return .failure(.unavailable) }
    }

    func update(_ collection: CardBinderCollection) async -> Result<CardBinderCollection, CollectionsError> {
        do {
            switch try await client.patchAppApiCollectionsCollectionId(
                path: .init(collectionId: UUIDCoding.encode(collection.id)),
                body: .json(
                    .init(
                        value1: .init(name: collection.name),
                        value2: .init(revision: collection.revision)
                    )
                )
            ) {
            case .ok(let response):
                return CollectionMapper.makeCollection(try response.body.json)
                    .mapError { _ in .unavailable }
            case .badRequest(let response):
                return .failure(.validation(TCGClientValidationErrorParser.parseIssues(from: try? response.body.json)))
            case .unauthorized: return .failure(.unauthorized)
            case .notFound: return .failure(.notFound)
            case .conflict: return .failure(.conflict)
            case .contentTooLarge: return .failure(.requestTooLarge)
            case .requestTimeout: return .failure(.timedOut)
            case .tooManyRequests: return .failure(.busy)
            case .serviceUnavailable(let response):
                return .failure(Self.serviceError(code: (try? response.body.json)?.code))
            case .internalServerError, .undocumented: return .failure(.unavailable)
            }
        } catch { return .failure(.unavailable) }
    }

    func save(_ collection: CardBinderCollection) async -> Result<CardBinderCollection, CollectionsError> {
        let payload = CollectionMapper.makeLayout(collection)
        do {
            switch try await client.putAppApiCollectionsCollectionIdLayout(
                path: .init(collectionId: UUIDCoding.encode(collection.id)),
                body: .json(payload)
            ) {
            case .ok(let response):
                return CollectionMapper.makeCollection(try response.body.json)
                    .mapError { _ in .unavailable }
            case .badRequest(let response):
                return .failure(.validation(TCGClientValidationErrorParser.parseIssues(from: try? response.body.json)))
            case .unauthorized: return .failure(.unauthorized)
            case .notFound: return .failure(.notFound)
            case .conflict: return .failure(.conflict)
            case .contentTooLarge: return .failure(.requestTooLarge)
            case .requestTimeout: return .failure(.timedOut)
            case .tooManyRequests: return .failure(.busy)
            case .serviceUnavailable(let response):
                return .failure(Self.serviceError(code: (try? response.body.json)?.code))
            case .internalServerError, .undocumented: return .failure(.unavailable)
            }
        } catch { return .failure(.unavailable) }
    }

    func delete(id: UUID) async -> Result<Void, CollectionsError> {
        do {
            switch try await client.deleteAppApiCollectionsCollectionId(
                path: .init(collectionId: UUIDCoding.encode(id))
            ) {
            case .ok(let response):
                _ = try response.body.json
                return .success(())
            case .badRequest(let response):
                return .failure(.validation(TCGClientValidationErrorParser.parseIssues(from: try? response.body.json)))
            case .unauthorized: return .failure(.unauthorized)
            case .notFound: return .failure(.notFound)
            case .conflict: return .failure(.conflict)
            case .contentTooLarge: return .failure(.requestTooLarge)
            case .requestTimeout: return .failure(.timedOut)
            case .tooManyRequests: return .failure(.busy)
            case .serviceUnavailable(let response):
                return .failure(Self.serviceError(code: (try? response.body.json)?.code))
            case .internalServerError, .undocumented: return .failure(.unavailable)
            }
        } catch { return .failure(.unavailable) }
    }

    func page(collectionID: UUID, pageID: UUID) async -> Result<BinderPageCards, CollectionsError> {
        do {
            switch try await client.getAppApiCollectionsCollectionIdPagesPageId(
                path: .init(collectionId: UUIDCoding.encode(collectionID), pageId: UUIDCoding.encode(pageID))
            ) {
            case .ok(let response):
                let value = try response.body.json
                return ResultMapping.map(value.cards, transform: TCGCardsClientImpl.makeCardWithPrice)
                    .map { BinderPageCards(cards: $0) }
                    .mapError { _ in .unavailable }
            case .badRequest(let response):
                return .failure(.validation(TCGClientValidationErrorParser.parseIssues(from: try? response.body.json)))
            case .unauthorized: return .failure(.unauthorized)
            case .notFound: return .failure(.notFound)
            case .conflict: return .failure(.conflict)
            case .contentTooLarge: return .failure(.requestTooLarge)
            case .requestTimeout: return .failure(.timedOut)
            case .tooManyRequests: return .failure(.busy)
            case .serviceUnavailable(let response):
                return .failure(Self.serviceError(code: (try? response.body.json)?.code))
            case .internalServerError, .undocumented: return .failure(.unavailable)
            }
        } catch { return .failure(.unavailable) }
    }

    func export(ids: [UUID]?) async -> Result<CollectionBackup, CollectionsError> {
        do {
            switch try await client.postAppApiCollectionsExport(
                body: .json(.init(collectionIds: ids?.map(UUIDCoding.encode)))
            ) {
            case .ok(let response):
                return CollectionMapper.makeBackup(try response.body.json)
            case .badRequest(let response):
                return .failure(.validation(TCGClientValidationErrorParser.parseIssues(from: try? response.body.json)))
            case .unauthorized: return .failure(.unauthorized)
            case .notFound: return .failure(.notFound)
            case .conflict: return .failure(.conflict)
            case .contentTooLarge: return .failure(.requestTooLarge)
            case .requestTimeout: return .failure(.timedOut)
            case .tooManyRequests: return .failure(.busy)
            case .serviceUnavailable(let response):
                return .failure(Self.serviceError(code: (try? response.body.json)?.code))
            case .internalServerError, .undocumented: return .failure(.unavailable)
            }
        } catch { return .failure(.unavailable) }
    }

    func preview(_ backup: CollectionBackup) async -> Result<CollectionBackupPreview, CollectionsError> {
        guard
            case .success(let payload) = CollectionMapper.makeGeneratedBackup(backup)
        else { return .failure(.unavailable) }
        do {
            switch try await client.postAppApiCollectionsImportPreview(
                body: .json(payload)
            ) {
            case .ok(let response):
                let preview = try response.body.json
                return .success(
                    CollectionBackupPreview(
                        newCollectionCount: preview.newCollectionCount,
                        updatedCollectionCount: preview.updatedCollectionCount,
                        newCardCount: preview.newCardCount,
                        updatedCardCount: preview.updatedCardCount,
                        movedCardCount: preview.movedCardCount
                    )
                )
            case .badRequest(let response):
                return .failure(.validation(TCGClientValidationErrorParser.parseIssues(from: try? response.body.json)))
            case .unauthorized: return .failure(.unauthorized)
            case .notFound: return .failure(.notFound)
            case .conflict: return .failure(.conflict)
            case .contentTooLarge: return .failure(.requestTooLarge)
            case .requestTimeout: return .failure(.timedOut)
            case .tooManyRequests: return .failure(.busy)
            case .serviceUnavailable(let response):
                return .failure(Self.serviceError(code: (try? response.body.json)?.code))
            case .internalServerError, .undocumented: return .failure(.unavailable)
            }
        } catch { return .failure(.unavailable) }
    }

    func importBackup(_ backup: CollectionBackup) async -> Result<ImportCollectionBackupResult, CollectionsError> {
        guard
            case .success(let payload) = CollectionMapper.makeGeneratedBackup(backup)
        else { return .failure(.unavailable) }
        do {
            switch try await client.postAppApiCollectionsImport(
                body: .json(payload)
            ) {
            case .ok(let response):
                let result = try response.body.json
                return .success(
                    ImportCollectionBackupResult(
                        importedCount: result.importedCount,
                        updatedCount: result.updatedCount,
                        skippedCount: result.skippedCount,
                        collectionCount: result.collectionCount
                    )
                )
            case .badRequest(let response):
                return .failure(.validation(TCGClientValidationErrorParser.parseIssues(from: try? response.body.json)))
            case .unauthorized: return .failure(.unauthorized)
            case .notFound: return .failure(.notFound)
            case .conflict: return .failure(.conflict)
            case .contentTooLarge: return .failure(.requestTooLarge)
            case .requestTimeout: return .failure(.timedOut)
            case .tooManyRequests: return .failure(.busy)
            case .serviceUnavailable(let response):
                return .failure(Self.serviceError(code: (try? response.body.json)?.code))
            case .internalServerError, .undocumented: return .failure(.unavailable)
            }
        } catch { return .failure(.unavailable) }
    }

    private static func serviceError(code: String?) -> CollectionsError {
        switch code {
        case "COLLECTION_BUSY": .busy
        case "COLLECTION_OPERATION_TIMEOUT": .timedOut
        default: .unavailable
        }
    }

}
