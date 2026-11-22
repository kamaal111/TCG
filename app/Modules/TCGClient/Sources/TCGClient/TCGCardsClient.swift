//
//  TCGCardsClient.swift
//  TCGClient
//
//  Created by Kamaal M Farah on 7/20/26.
//

import Foundation
import HTTPTypes
import KamaalLogger
import OpenAPIRuntime

public protocol TCGCardsClient: Sendable {
    func details(id: UUID) async -> Result<CardWithPrice, OwnedCardReadError>

    func prices(ids: [UUID]) async -> Result<[OwnedCardPriceUpdate], OwnedCardReadError>

    func exportCards() async -> Result<[Card], CardBackupErrors>

    func importCards(_ payload: ImportCardsPayload) async -> Result<ImportCardsResult, CardBackupErrors>

    /// Matches any selected set name exactly; an empty selection includes all sets.
    func listPage(_ query: ListCardsQuery) async -> Result<
        CardCollectionPage, ListCardsErrors
    >

    func create(with payload: CreateCardPayload) async -> Result<CardWithPrice, CreateCardErrors>

    func update(id: UUID, with payload: UpdateCardPayload) async -> Result<CardWithPrice, UpdateCardErrors>

    func delete(ids: [UUID]) async -> Result<DeleteCardsResult, DeleteCardsErrors>
}

private let logger = KamaalLogger(from: TCGCardsClientImpl.self)

struct TCGCardsClientImpl: TCGCardsClient {
    private let client: Client

    init(client: Client) {
        self.client = client
    }

    func exportCards() async -> Result<[Card], CardBackupErrors> {
        var cards: [Card] = []
        var cursor: String?
        var visitedCursors: Set<String> = []
        var cardIDs: Set<UUID> = []

        repeat {
            guard !Task.isCancelled else {
                return .failure(.unknown(status: HTTPResponse.Status.serviceUnavailable.code))
            }

            let output: Operations.GetAppApiCardsExport.Output
            do {
                output = try await client.getAppApiCardsExport(query: .init(cursor: cursor))
            } catch {
                return .failure(.unknown(status: HTTPResponse.Status.serviceUnavailable.code))
            }

            switch output {
            case .ok(let response):
                do {
                    let page = try response.body.json
                    guard !Task.isCancelled else {
                        return .failure(.unknown(status: HTTPResponse.Status.serviceUnavailable.code))
                    }

                    if let next = page.nextCursor {
                        guard !next.isEmpty else {
                            return .failure(.unknown(status: HTTPResponse.Status.serviceUnavailable.code))
                        }
                        guard !page.entries.isEmpty else {
                            return .failure(.unknown(status: HTTPResponse.Status.serviceUnavailable.code))
                        }
                        guard visitedCursors.insert(next).inserted else {
                            return .failure(.unknown(status: HTTPResponse.Status.serviceUnavailable.code))
                        }
                    }

                    switch CardMapper.makeCards(page.entries) {
                    case .success(let mapped):
                        cards.append(contentsOf: mapped.filter { cardIDs.insert($0.id).inserted })
                    case .failure: return .failure(.unknown(status: HTTPResponse.Status.serviceUnavailable.code))
                    }
                    cursor = page.nextCursor
                } catch {
                    return .failure(.unknown(status: HTTPResponse.Status.serviceUnavailable.code))
                }
            case .badRequest(let response):
                return .failure(
                    .badRequest(
                        validations: TCGClientValidationErrorParser.parseIssues(from: try? response.body.json)
                    )
                )
            case .unauthorized:
                return .failure(.unauthorized)
            case .internalServerError:
                return .failure(.unknown(status: 500))
            case .undocumented(let status, _):
                return .failure(.unknown(status: status))
            }
        } while cursor != nil

        return .success(cards)
    }

    func importCards(_ payload: ImportCardsPayload) async -> Result<ImportCardsResult, CardBackupErrors> {
        let attemptID = UUID()
        logger.info(
            "cards.import.submission",
            fields: [
                .init("attempt_id", attemptID.uuidString, privacy: .public),
                .init("card_count", object: payload.cards.count, privacy: .public),
            ]
        )

        let generated = CardMapper.makeImportRequest(payload)
        let output: Operations.PostAppApiCardsImport.Output
        do {
            output = try await client.postAppApiCardsImport(body: .json(generated))
        } catch {
            return .failure(Self.importFailure(error, attemptID: attemptID))
        }

        switch output {
        case .ok(let response):
            do {
                let result = try response.body.json
                logger.info(
                    "cards.import.confirmed",
                    fields: [
                        .init("attempt_id", attemptID.uuidString, privacy: .public),
                        .init("http_status", object: 200, privacy: .public),
                        .init("imported_count", object: result.importedCount, privacy: .public),
                        .init("updated_count", object: result.updatedCount, privacy: .public),
                        .init("skipped_count", object: result.skippedCount, privacy: .public),
                    ]
                )

                return .success(CardMapper.makeImportResult(result))
            } catch {
                return .failure(Self.importFailure(error, attemptID: attemptID))
            }
        case .badRequest(let response):
            let issues = TCGClientValidationErrorParser.parseIssues(from: try? response.body.json)
            logger.warning(
                "cards.import.rejected",
                fields: [
                    .init("attempt_id", attemptID.uuidString, privacy: .public),
                    .init("http_status", object: 400, privacy: .public),
                    .init("issue_count", object: issues.count, privacy: .public),
                ]
            )
            for issue in issues {
                logger.warning(
                    "cards.import.validation",
                    fields: [
                        .init("attempt_id", attemptID.uuidString, privacy: .public),
                        .init("code", issue.code),
                        .init("path", issue.path.joined(separator: ".")),
                        .init("message", issue.message),
                    ]
                )
            }

            return .failure(.badRequest(validations: issues))
        case .unauthorized:
            logger.warning(
                "cards.import.rejected",
                fields: [
                    .init("attempt_id", attemptID.uuidString, privacy: .public),
                    .init("http_status", object: 401, privacy: .public),
                ]
            )
            return .failure(.unauthorized)
        case .internalServerError:
            logger.error(
                "cards.import.failed",
                fields: [
                    .init("attempt_id", attemptID.uuidString, privacy: .public),
                    .init("http_status", object: 500, privacy: .public),
                ]
            )
            return .failure(.unknown(status: 500))
        case .undocumented(let status, _):
            logger.error(
                "cards.import.failed",
                fields: [
                    .init("attempt_id", attemptID.uuidString, privacy: .public),
                    .init("http_status", object: status, privacy: .public),
                ]
            )
            return .failure(.unknown(status: status))
        }
    }

    private static func importFailure(_ error: any Error, attemptID: UUID) -> CardBackupErrors {
        guard let clientError = error as? ClientError else {
            logger.error(
                "cards.import.failed",
                fields: [
                    .init("attempt_id", attemptID.uuidString, privacy: .public),
                    .init("stage", "request", privacy: .public),
                    .init("cause", "\(type(of: error))", privacy: .public),
                ]
            )
            return .requestFailed
        }

        guard let response = clientError.response else {
            logger.error(
                "cards.import.failed",
                fields: [
                    .init("attempt_id", attemptID.uuidString, privacy: .public),
                    .init("stage", "request", privacy: .public),
                    .init("cause", "\(type(of: clientError.underlyingError))", privacy: .public),
                ]
            )
            return .requestFailed
        }

        let status = response.status.code
        logger.error(
            "cards.import.failed",
            fields: [
                .init("attempt_id", attemptID.uuidString, privacy: .public),
                .init("stage", "response_decoding", privacy: .public),
                .init("http_status", object: status, privacy: .public),
                .init("cause", "\(type(of: clientError.underlyingError))", privacy: .public),
                .init("path", Self.decodingPath(clientError.underlyingError)),
            ]
        )

        switch status {
        case 400: return .badRequest(validations: [])
        case 401: return .unauthorized
        case 200: return .invalidResponse(status: status)
        default: return .unknown(status: status)
        }
    }

    private static func decodingPath(_ error: any Error) -> String {
        switch error {
        case DecodingError.keyNotFound(let key, let context):
            (context.codingPath + [key]).map(\.stringValue).joined(separator: ".")
        case DecodingError.typeMismatch(_, let context), DecodingError.valueNotFound(_, let context),
            DecodingError.dataCorrupted(let context):
            context.codingPath.map(\.stringValue).joined(separator: ".")
        default: ""
        }
    }

    func listPage(_ query: ListCardsQuery) async -> Result<
        CardCollectionPage, ListCardsErrors
    > {
        let response: Operations.GetAppApiCards.Output
        do {
            response = try await client.getAppApiCards(query: CardMapper.makeListQuery(query))
        } catch {
            RequestDiagnosticsMiddleware.processingFailure(
                error,
                operation: "cards.list",
                logger: KamaalLogger(from: RequestDiagnosticsMiddleware.self)
            )
            return .failure(.unknown(status: HTTPResponse.Status.serviceUnavailable.code, payload: nil, cause: error))
        }

        switch response {
        case .ok(let response):
            do {
                let collection = try response.body.json
                if let next = collection.nextCursor {
                    guard !next.isEmpty else {
                        return .failure(
                            .unknown(status: HTTPResponse.Status.serviceUnavailable.code, payload: nil, cause: nil)
                        )
                    }
                    guard !collection.entries.isEmpty else {
                        return .failure(
                            .unknown(status: HTTPResponse.Status.serviceUnavailable.code, payload: nil, cause: nil)
                        )
                    }
                }

                return CardMapper.makeCollectionPage(collection)
                    .mapError { error in
                        RequestDiagnosticsMiddleware.mappingFailure(
                            operation: "cards.list",
                            logger: KamaalLogger(from: RequestDiagnosticsMiddleware.self)
                        )
                        return .unknown(status: HTTPResponse.Status.serviceUnavailable.code, payload: nil, cause: error)
                    }
            } catch {
                RequestDiagnosticsMiddleware.processingFailure(
                    error,
                    operation: "cards.list",
                    logger: KamaalLogger(from: RequestDiagnosticsMiddleware.self)
                )
                return .failure(
                    .unknown(status: HTTPResponse.Status.serviceUnavailable.code, payload: nil, cause: error)
                )
            }
        case .unauthorized:
            return .failure(.unauthorized)
        case .badRequest:
            return .failure(.unknown(status: 400, payload: nil, cause: nil))
        case .internalServerError:
            return .failure(.unknown(status: 500, payload: nil, cause: nil))
        case .notFound(let response):
            let code = (try? response.body.json)?.code
            return .failure(
                code == "COLLECTION_NOT_FOUND" ? .collectionNotFound : .unknown(status: 404, payload: nil, cause: nil)
            )
        case .undocumented(let status, let payload):
            return .failure(.unknown(status: status, payload: payload, cause: nil))
        }
    }

    func details(id: UUID) async -> Result<CardWithPrice, OwnedCardReadError> {
        let output: Operations.GetOwnedCard.Output
        do {
            output = try await client.getOwnedCard(path: .init(cardId: UUIDCoding.encode(id)))
        } catch {
            return .failure(.unavailable)
        }

        switch output {
        case .ok(let response):
            guard let details = try? response.body.json else { return .failure(.unavailable) }

            return CardMapper.makeOwnedDetails(details).mapError { _ in .unavailable }
        case .notFound(let response):
            let code = (try? response.body.json)?.code
            return .failure(code == "CARD_NOT_FOUND" ? .notFound : .unavailable)
        case .badRequest(let response):
            return .failure(.badRequest(TCGClientValidationErrorParser.parseIssues(from: try? response.body.json)))
        case .unauthorized: return .failure(.unauthorized)
        case .undocumented: return .failure(.unavailable)
        }
    }

    func prices(ids: [UUID]) async -> Result<[OwnedCardPriceUpdate], OwnedCardReadError> {
        let output: Operations.GetOwnedCardPrices.Output
        do {
            output = try await client.getOwnedCardPrices(body: .json(CardMapper.makePriceRequest(ids)))
        } catch {
            return .failure(.unavailable)
        }

        switch output {
        case .ok(let response):
            guard let result = try? response.body.json else { return .failure(.unavailable) }

            return CardMapper.makePriceUpdates(result).mapError { _ in .unavailable }
        case .badRequest(let response):
            return .failure(.badRequest(TCGClientValidationErrorParser.parseIssues(from: try? response.body.json)))
        case .unauthorized: return .failure(.unauthorized)
        case .undocumented: return .failure(.unavailable)
        }
    }

    func create(with payload: CreateCardPayload) async -> Result<CardWithPrice, CreateCardErrors> {
        let response: Operations.PostAppApiCards.Output
        do {
            response = try await client.postAppApiCards(body: .json(CardMapper.makeCreateRequest(payload)))
        } catch {
            return .failure(.unknown(status: HTTPResponse.Status.serviceUnavailable.code, payload: nil, cause: error))
        }

        switch response {
        case .created(let response):
            do {
                return CardMapper.makeCardWithPrice(try response.body.json)
                    .mapError { .unknown(status: HTTPResponse.Status.serviceUnavailable.code, payload: nil, cause: $0) }
            } catch {
                return .failure(
                    .unknown(status: HTTPResponse.Status.serviceUnavailable.code, payload: nil, cause: error)
                )
            }
        case .badRequest(let response):
            return .failure(
                .badRequest(validations: TCGClientValidationErrorParser.parseIssues(from: try? response.body.json))
            )
        case .unauthorized:
            return .failure(.unauthorized)
        case .serviceUnavailable:
            return .failure(.unavailable)
        case .undocumented(let status, let payload):
            return .failure(.unknown(status: status, payload: payload, cause: nil))
        }
    }

    func update(id: UUID, with payload: UpdateCardPayload) async -> Result<CardWithPrice, UpdateCardErrors> {
        let response: Operations.PutAppApiCardsCardId.Output
        do {
            response = try await client.putAppApiCardsCardId(
                path: .init(cardId: UUIDCoding.encode(id)),
                body: .json(CardMapper.makeUpdateRequest(payload))
            )
        } catch {
            return .failure(.unknown(status: HTTPResponse.Status.serviceUnavailable.code, payload: nil, cause: error))
        }

        switch response {
        case .ok(let response):
            do {
                return CardMapper.makeCardWithPrice(try response.body.json)
                    .mapError { .unknown(status: HTTPResponse.Status.serviceUnavailable.code, payload: nil, cause: $0) }
            } catch {
                return .failure(
                    .unknown(status: HTTPResponse.Status.serviceUnavailable.code, payload: nil, cause: error)
                )
            }
        case .badRequest(let response):
            return .failure(
                .badRequest(validations: TCGClientValidationErrorParser.parseIssues(from: try? response.body.json))
            )
        case .unauthorized:
            return .failure(.unauthorized)
        case .notFound:
            return .failure(.notFound)
        case .serviceUnavailable:
            return .failure(.unavailable)
        case .undocumented(let status, let payload):
            return .failure(.unknown(status: status, payload: payload, cause: nil))
        }
    }

    func delete(ids: [UUID]) async -> Result<DeleteCardsResult, DeleteCardsErrors> {
        let response: Operations.DeleteAppApiCards.Output
        do {
            response = try await client.deleteAppApiCards(
                body: .json(CardMapper.makeDeleteRequest(ids))
            )
        } catch {
            return .failure(.unknown(status: HTTPResponse.Status.serviceUnavailable.code, payload: nil, cause: error))
        }

        switch response {
        case .ok(let response):
            do {
                let result = try response.body.json
                return CardMapper.makeDeleteResult(result)
                    .mapError { .unknown(status: HTTPResponse.Status.serviceUnavailable.code, payload: nil, cause: $0) }
            } catch {
                return .failure(
                    .unknown(status: HTTPResponse.Status.serviceUnavailable.code, payload: nil, cause: error)
                )
            }
        case .badRequest(let response):
            return .failure(
                .badRequest(validations: TCGClientValidationErrorParser.parseIssues(from: try? response.body.json))
            )
        case .unauthorized:
            return .failure(.unauthorized)
        case .undocumented(let status, let payload):
            return .failure(.unknown(status: status, payload: payload, cause: nil))
        }
    }

}
