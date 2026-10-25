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
import TCGUtils

public protocol TCGCardsClient: Sendable {
    func exportCards() async -> Result<[Card], CardBackupErrors>

    func importCards(_ payload: ImportCardsPayload) async -> Result<ImportCardsResult, CardBackupErrors>

    /// Matches any selected set name exactly; an empty selection includes all sets.
    func listPage(_ query: ListCardsQuery) async -> Result<
        CardCollectionPage, ListCardsErrors
    >

    func create(with payload: UpsertCardPayload) async -> Result<CardWithPrice, CreateCardErrors>

    func update(id: UUID, with payload: UpsertCardPayload) async -> Result<CardWithPrice, UpdateCardErrors>

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

            do {
                switch try await client.getAppApiCardsExport(query: .init(cursor: cursor)) {
                case .ok(let response):
                    let page = try response.body.json
                    guard !Task.isCancelled else {
                        return .failure(.unknown(status: HTTPResponse.Status.serviceUnavailable.code))
                    }

                    if let next = page.nextCursor {
                        guard !next.isEmpty else {
                            return .failure(.unknown(status: HTTPResponse.Status.serviceUnavailable.code))
                        }
                        guard !page.cards.isEmpty else {
                            return .failure(.unknown(status: HTTPResponse.Status.serviceUnavailable.code))
                        }
                        guard visitedCursors.insert(next).inserted else {
                            return .failure(.unknown(status: HTTPResponse.Status.serviceUnavailable.code))
                        }
                    }

                    switch ResultMapping.map(page.cards, transform: Self.makeCard) {
                    case .success(let mapped):
                        cards.append(contentsOf: mapped.filter { cardIDs.insert($0.id).inserted })
                    case .failure: return .failure(.unknown(status: HTTPResponse.Status.serviceUnavailable.code))
                    }
                    cursor = page.nextCursor
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
            } catch {
                return .failure(.unknown(status: HTTPResponse.Status.serviceUnavailable.code))
            }
        } while cursor != nil

        return .success(cards)
    }

    func importCards(_ payload: ImportCardsPayload) async -> Result<ImportCardsResult, CardBackupErrors> {
        let attemptID = UUID()
        logger.info("event=cards.import.submission; attempt_id=\(attemptID); card_count=\(payload.cards.count)")

        do {
            let generated = Components.Schemas.ImportCards(cards: payload.cards.map(Self.makeGeneratedImportCard))
            switch try await client.postAppApiCardsImport(body: .json(generated)) {
            case .ok(let response):
                let result = try response.body.json
                logger.info(
                    "event=cards.import.confirmed; attempt_id=\(attemptID); http_status=200; imported_count=\(result.importedCount); updated_count=\(result.updatedCount); skipped_count=\(result.skippedCount)"
                )

                return .success(
                    .init(
                        importedCount: result.importedCount,
                        updatedCount: result.updatedCount,
                        skippedCount: result.skippedCount,
                        allocationAdjustments: result.allocationAdjustments
                    )
                )
            case .badRequest(let response):
                let issues = TCGClientValidationErrorParser.parseIssues(from: try? response.body.json)
                logger.warning(
                    "event=cards.import.rejected; attempt_id=\(attemptID); http_status=400; issue_count=\(issues.count)"
                )
                for issue in issues {
                    logger.warning(
                        "event=cards.import.validation; attempt_id=\(attemptID); code=\(issue.code); path=\(issue.path.joined(separator: ".")); message=\(issue.message)"
                    )
                }

                return .failure(.badRequest(validations: issues))
            case .unauthorized:
                logger.warning("event=cards.import.rejected; attempt_id=\(attemptID); http_status=401")
                return .failure(.unauthorized)
            case .internalServerError:
                logger.error("event=cards.import.failed; attempt_id=\(attemptID); http_status=500")
                return .failure(.unknown(status: 500))
            case .undocumented(let status, _):
                logger.error("event=cards.import.failed; attempt_id=\(attemptID); http_status=\(status)")
                return .failure(.unknown(status: status))
            }
        } catch {
            guard let clientError = error as? ClientError else {
                logger.error(
                    "event=cards.import.failed; attempt_id=\(attemptID); stage=request; cause=\(type(of: error))"
                )
                return .failure(.requestFailed)
            }

            guard let response = clientError.response else {
                logger.error(
                    "event=cards.import.failed; attempt_id=\(attemptID); stage=request; cause=\(type(of: clientError.underlyingError))"
                )
                return .failure(.requestFailed)
            }

            let status = response.status.code
            logger.error(
                "event=cards.import.failed; attempt_id=\(attemptID); stage=response_decoding; http_status=\(status); cause=\(type(of: clientError.underlyingError)); path=\(Self.decodingPath(clientError.underlyingError))"
            )

            switch status {
            case 400: return .failure(.badRequest(validations: []))
            case 401: return .failure(.unauthorized)
            case 200: return .failure(.invalidResponse(status: status))
            default: return .failure(.unknown(status: status))
            }
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
            response = try await client.getAppApiCards(
                query: .init(
                    cursor: query.cursor,
                    collectionId: query.collectionID.map(UUIDCoding.encode),
                    query: query.query,
                    game: query.game.map(Self.makeListGame),
                    setName: query.setNames.isEmpty ? nil : query.setNames.sorted()
                )
            )
        } catch {
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
                    guard !collection.cards.isEmpty else {
                        return .failure(
                            .unknown(status: HTTPResponse.Status.serviceUnavailable.code, payload: nil, cause: nil)
                        )
                    }
                }

                return ResultMapping.map(collection.cards, transform: Self.makeCardWithPrice)
                    .map { cards in
                        CardCollectionPage(
                            cards: cards,
                            availableSetNames: Set(collection.availableSetNames),
                            nextCursor: collection.nextCursor
                        )
                    }
                    .mapError { .unknown(status: HTTPResponse.Status.serviceUnavailable.code, payload: nil, cause: $0) }
            } catch {
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
        case .serviceUnavailable:
            return .failure(.unavailable)
        case .undocumented(let status, let payload):
            return .failure(.unknown(status: status, payload: payload, cause: nil))
        }
    }

    func create(with payload: UpsertCardPayload) async -> Result<CardWithPrice, CreateCardErrors> {
        let response: Operations.PostAppApiCards.Output
        do {
            response = try await client.postAppApiCards(body: .json(Self.makeGeneratedPayload(payload)))
        } catch {
            return .failure(.unknown(status: HTTPResponse.Status.serviceUnavailable.code, payload: nil, cause: error))
        }

        switch response {
        case .created(let response):
            do {
                return Self.makeCardWithPrice(try response.body.json)
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

    func update(id: UUID, with payload: UpsertCardPayload) async -> Result<CardWithPrice, UpdateCardErrors> {
        let response: Operations.PutAppApiCardsCardId.Output
        do {
            response = try await client.putAppApiCardsCardId(
                path: .init(cardId: UUIDCoding.encode(id)),
                body: .json(Self.makeGeneratedPayload(payload))
            )
        } catch {
            return .failure(.unknown(status: HTTPResponse.Status.serviceUnavailable.code, payload: nil, cause: error))
        }

        switch response {
        case .ok(let response):
            do {
                return Self.makeCardWithPrice(try response.body.json)
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
        let payload = DeleteCardsPayload(cardIDs: ids)
        let response: Operations.DeleteAppApiCards.Output
        do {
            response = try await client.deleteAppApiCards(
                body: .json(.init(cardIds: payload.cardIDs.map(UUIDCoding.encode)))
            )
        } catch {
            return .failure(.unknown(status: HTTPResponse.Status.serviceUnavailable.code, payload: nil, cause: error))
        }

        switch response {
        case .ok(let response):
            do {
                let result = try response.body.json
                return ResultMapping.map(result.deletedIds, transform: UUIDCoding.decode)
                    .flatMap { deletedIDs in
                        ResultMapping.map(result.notFoundIds, transform: UUIDCoding.decode)
                            .map { notFoundIDs in
                                DeleteCardsResult(deletedIDs: deletedIDs, notFoundIDs: notFoundIDs)
                            }
                    }
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

    static func makeGeneratedImportCard(_ card: ImportCardPayload) -> Components.Schemas.ImportCard {
        .init(
            game: makeImportGame(card.game),
            name: card.name,
            setName: card.setName,
            cardNumber: card.cardNumber,
            collectionId: card.collectionID.map(UUIDCoding.encode),
            notes: card.notes,
            purchases: card.purchases.map { purchase in
                .init(
                    id: UUIDCoding.encode(purchase.id),
                    condition: makeImportCondition(purchase.condition),
                    quantity: purchase.quantity,
                    purchasePrice: purchase.purchasePrice,
                    currency: purchase.currency.map(PricedCardMapper.generatedNullableCurrency),
                    automaticPriceDate: purchase.automaticPriceDate
                )
            },
            id: UUIDCoding.encode(card.id),
            createdAt: card.createdAt,
            updatedAt: card.updatedAt
        )
    }

    private static func makeImportGame(_ game: ClientCardGame) -> Components.Schemas.ImportCard.GamePayload {
        switch game {
        case .onePiece: .onePiece
        case .pokemon: .pokemon
        }
    }

    private static func makeImportCondition(
        _ condition: CardCondition
    ) -> Components.Schemas.ImportCard.PurchasesPayloadPayload.ConditionPayload {
        switch condition {
        case .mint: .mint
        case .nearMint: .nearMint
        case .excellent: .excellent
        case .good: .good
        case .played: .played
        case .damaged: .damaged
        }
    }

    private static func makeGeneratedPayload(_ payload: UpsertCardPayload) -> Components.Schemas.UpsertCard {
        .init(
            game: makeGeneratedGame(payload.game),
            name: payload.name,
            setName: payload.setName,
            cardNumber: payload.cardNumber,
            collectionId: payload.collectionID.map(UUIDCoding.encode),
            notes: payload.notes,
            purchases: payload.purchases.map(Self.makeGeneratedBatch)
        )
    }

    private static func makeListGame(_ game: ClientCardGame) -> Operations.GetAppApiCards.Input.Query.GamePayload {
        switch game {
        case .onePiece: .onePiece
        case .pokemon: .pokemon
        }
    }

    static func makeCardWithPrice(
        _ cardWithPrice: Components.Schemas.CardWithPrice
    ) -> Result<CardWithPrice, UUIDCodingError> {
        makeCard(cardWithPrice.value1)
            .flatMap { card in
                PricedCardMapper.makeOwnedPrice(cardWithPrice.value2.price)
                    .map { price in
                        CardWithPrice(card: card, price: price)
                    }
            }
    }

    private static func makeCard(_ card: Components.Schemas.Card) -> Result<Card, UUIDCodingError> {
        UUIDCoding.decode(card.id)
            .flatMap { id in
                UUIDCoding.decode(card.collectionId)
                    .flatMap { collectionID in
                        ResultMapping.map(card.purchases, transform: Self.makeBatch)
                            .map { purchases in
                                Card(
                                    id: id,
                                    game: makeGame(card.game),
                                    name: card.name,
                                    setName: card.setName,
                                    cardNumber: card.cardNumber,
                                    notes: card.notes,
                                    createdAt: card.createdAt,
                                    updatedAt: card.updatedAt,
                                    purchases: purchases,
                                    purchasePriceChangePercent: card.purchasePriceChangePercent,
                                    displayCurrency: card.displayCurrency.map(PricedCardMapper.makeCurrency),
                                    collectionID: collectionID,
                                    allocationAdjustments: card.allocationAdjustments
                                )
                            }
                    }
            }
    }

    private static func makeGeneratedBatch(_ batch: CardPurchase) -> Components.Schemas.CardPurchaseInput {
        .init(
            id: batch.id.map(UUIDCoding.encode),
            condition: makeGeneratedCondition(batch.condition),
            quantity: batch.quantity,
            purchasePrice: batch.purchasePrice.map { NSDecimalNumber(decimal: $0).stringValue },
            currency: batch.currency.map(PricedCardMapper.generatedNullableCurrency)
        )
    }

    private static func makeBatch(_ batch: Components.Schemas.CardPurchase) -> Result<CardPurchase, UUIDCodingError> {
        UUIDCoding.decode(batch.id)
            .map { id in
                CardPurchase(
                    id: id,
                    condition: makeCondition(batch.condition),
                    quantity: batch.quantity,
                    purchasePrice: batch.purchasePrice.flatMap {
                        Decimal(string: $0, locale: TCGLocales.decimal)
                    },
                    currency: batch.currency.flatMap(PricedCardMapper.makeCurrency),
                    automaticPriceDate: batch.automaticPriceDate,
                    displayPrice: batch.displayPrice.flatMap { display in
                        Decimal(string: display.amount, locale: TCGLocales.decimal)
                            .map {
                                PurchaseDisplayPrice(
                                    amount: $0,
                                    currency: PricedCardMapper.makeCurrency(display.currency),
                                    conversionUnavailable: display.conversionUnavailable
                                )
                            }
                    }
                )
            }
    }

    private static func makeGeneratedCondition(
        _ condition: CardCondition
    ) -> Components.Schemas.CardPurchaseInput.ConditionPayload {
        switch condition {
        case .mint: .mint
        case .nearMint: .nearMint
        case .excellent: .excellent
        case .good: .good
        case .played: .played
        case .damaged: .damaged
        }
    }

    private static func makeCondition(_ condition: Components.Schemas.CardPurchase.ConditionPayload) -> CardCondition {
        switch condition {
        case .mint: .mint
        case .nearMint: .nearMint
        case .excellent: .excellent
        case .good: .good
        case .played: .played
        case .damaged: .damaged
        }
    }

    private static func makeGeneratedGame(_ game: ClientCardGame) -> Components.Schemas.UpsertCard.GamePayload {
        switch game {
        case .onePiece: .onePiece
        case .pokemon: .pokemon
        }
    }

    private static func makeGame(_ game: Components.Schemas.Card.GamePayload) -> ClientCardGame {
        switch game {
        case .onePiece: .onePiece
        case .pokemon: .pokemon
        }
    }
}
