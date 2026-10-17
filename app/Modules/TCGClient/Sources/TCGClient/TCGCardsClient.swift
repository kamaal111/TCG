//
//  TCGCardsClient.swift
//  TCGClient
//
//  Created by Kamaal M Farah on 7/20/26.
//

import Foundation
import KamaalLogger
import OpenAPIRuntime
import TCGUtils

public protocol TCGCardsClient: Sendable {
    func exportCards() async -> Result<[Card], CardBackupErrors>
    func importCards(_ payload: ImportCardsPayload) async -> Result<ImportCardsResult, CardBackupErrors>
    /// Matches any selected set name exactly; an empty selection includes all sets.
    func listPage(game: ClientCardGame?, setNames: Set<String>, cursor: String?) async -> Result<
        CardCollectionPage, ListCardsErrors
    >
    func create(with payload: UpsertCardPayload) async -> Result<CardWithPrice, CreateCardErrors>
    func update(id: String, with payload: UpsertCardPayload) async -> Result<CardWithPrice, UpdateCardErrors>
    func delete(ids: [String]) async -> Result<DeleteCardsResult, DeleteCardsErrors>
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
        var cardIDs: Set<String> = []

        repeat {
            guard !Task.isCancelled else { return .failure(.unknown(status: 503)) }

            do {
                switch try await client.getAppApiCardsExport(query: .init(cursor: cursor)) {
                case .ok(let response):
                    let page = try response.body.json
                    guard !Task.isCancelled else { return .failure(.unknown(status: 503)) }

                    if let next = page.nextCursor {
                        guard !next.isEmpty else { return .failure(.unknown(status: 503)) }
                        guard !page.cards.isEmpty else { return .failure(.unknown(status: 503)) }
                        guard visitedCursors.insert(next).inserted else { return .failure(.unknown(status: 503)) }
                    }

                    cards.append(contentsOf: page.cards.map(Self.makeCard).filter { cardIDs.insert($0.id).inserted })
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
                return .failure(.unknown(status: 503))
            }
        } while cursor != nil

        return .success(cards)
    }

    func importCards(_ payload: ImportCardsPayload) async -> Result<ImportCardsResult, CardBackupErrors> {
        let attemptID = UUID().uuidString
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
                        skippedCount: result.skippedCount
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

    func listPage(game: ClientCardGame?, setNames: Set<String>, cursor: String?) async -> Result<
        CardCollectionPage, ListCardsErrors
    > {
        let response: Operations.GetAppApiCards.Output
        do {
            response = try await client.getAppApiCards(
                query: .init(
                    cursor: cursor,
                    game: game.map(Self.makeListGame),
                    setName: setNames.isEmpty ? nil : setNames.sorted()
                )
            )
        } catch {
            return .failure(.unknown(status: 503, payload: nil, cause: error))
        }

        switch response {
        case .ok(let response):
            do {
                let collection = try response.body.json
                if let next = collection.nextCursor {
                    guard !next.isEmpty else { return .failure(.unknown(status: 503, payload: nil, cause: nil)) }
                    guard !collection.cards.isEmpty else {
                        return .failure(.unknown(status: 503, payload: nil, cause: nil))
                    }
                }

                return .success(
                    CardCollectionPage(
                        cards: collection.cards.map(Self.makeCardWithPrice),
                        availableSetNames: Set(collection.availableSetNames),
                        nextCursor: collection.nextCursor
                    )
                )
            } catch {
                return .failure(.unknown(status: 503, payload: nil, cause: error))
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
            return .failure(.unknown(status: 503, payload: nil, cause: error))
        }

        switch response {
        case .created(let response):
            do {
                return .success(Self.makeCardWithPrice(try response.body.json))
            } catch {
                return .failure(.unknown(status: 503, payload: nil, cause: error))
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

    func update(id: String, with payload: UpsertCardPayload) async -> Result<CardWithPrice, UpdateCardErrors> {
        let response: Operations.PutAppApiCardsCardId.Output
        do {
            response = try await client.putAppApiCardsCardId(
                path: .init(cardId: id),
                body: .json(Self.makeGeneratedPayload(payload))
            )
        } catch {
            return .failure(.unknown(status: 503, payload: nil, cause: error))
        }

        switch response {
        case .ok(let response):
            do {
                return .success(Self.makeCardWithPrice(try response.body.json))
            } catch {
                return .failure(.unknown(status: 503, payload: nil, cause: error))
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

    func delete(ids: [String]) async -> Result<DeleteCardsResult, DeleteCardsErrors> {
        let payload = DeleteCardsPayload(cardIDs: ids)
        let response: Operations.DeleteAppApiCards.Output
        do {
            response = try await client.deleteAppApiCards(body: .json(.init(cardIds: payload.cardIDs)))
        } catch {
            return .failure(.unknown(status: 503, payload: nil, cause: error))
        }

        switch response {
        case .ok(let response):
            do {
                let result = try response.body.json
                return .success(DeleteCardsResult(deletedIDs: result.deletedIds, notFoundIDs: result.notFoundIds))
            } catch {
                return .failure(.unknown(status: 503, payload: nil, cause: error))
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

    private static func makeGeneratedImportCard(_ card: ImportCardPayload) -> Components.Schemas.ImportCard {
        .init(
            game: makeImportGame(card.game),
            name: card.name,
            setName: card.setName,
            cardNumber: card.cardNumber,
            notes: card.notes,
            purchases: card.purchases.map { purchase in
                .init(
                    id: purchase.id,
                    condition: makeImportCondition(purchase.condition),
                    quantity: purchase.quantity,
                    purchasePrice: purchase.purchasePrice,
                    currency: purchase.currency.map(makeGeneratedPurchaseCurrency),
                    automaticPriceDate: purchase.automaticPriceDate
                )
            },
            id: card.id,
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

    private static func makeGeneratedPurchaseCurrency(
        _ currency: Currency
    ) -> Components.Schemas.NullableCurrency {
        switch currency {
        case .eur: .eur
        case .usd: .usd
        case .jpy: .jpy
        case .czk: .czk
        case .dkk: .dkk
        case .gbp: .gbp
        case .huf: .huf
        case .pln: .pln
        case .ron: .ron
        case .sek: .sek
        case .chf: .chf
        case .isk: .isk
        case .nok: .nok
        case .try: ._try
        case .aud: .aud
        case .brl: .brl
        case .cad: .cad
        case .cny: .cny
        case .hkd: .hkd
        case .idr: .idr
        case .ils: .ils
        case .inr: .inr
        case .krw: .krw
        case .mxn: .mxn
        case .myr: .myr
        case .nzd: .nzd
        case .php: .php
        case .sgd: .sgd
        case .thb: .thb
        case .zar: .zar
        }
    }

    private static func makeGeneratedPayload(_ payload: UpsertCardPayload) -> Components.Schemas.UpsertCard {
        .init(
            game: makeGeneratedGame(payload.game),
            name: payload.name,
            setName: payload.setName,
            cardNumber: payload.cardNumber,
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

    private static func makeCardWithPrice(_ cardWithPrice: Components.Schemas.CardWithPrice) -> CardWithPrice {
        CardWithPrice(
            card: makeCard(cardWithPrice.value1),
            price: PricedCardMapper.makeOwnedPrice(cardWithPrice.value2.price)
        )
    }

    private static func makeCard(_ card: Components.Schemas.Card) -> Card {
        Card(
            id: card.id,
            game: makeGame(card.game),
            name: card.name,
            setName: card.setName,
            cardNumber: card.cardNumber,
            notes: card.notes,
            createdAt: card.createdAt,
            updatedAt: card.updatedAt,
            purchases: card.purchases.map(Self.makeBatch),
            purchasePriceChangePercent: card.purchasePriceChangePercent,
            displayCurrency: card.displayCurrency.map(PricedCardMapper.makeCurrency)
        )
    }

    private static func makeGeneratedBatch(_ batch: CardPurchase) -> Components.Schemas.CardPurchaseInput {
        .init(
            id: batch.id,
            condition: makeGeneratedCondition(batch.condition),
            quantity: batch.quantity,
            purchasePrice: batch.purchasePrice.map { NSDecimalNumber(decimal: $0).stringValue },
            currency: batch.currency.map(makeGeneratedPurchaseCurrency)
        )
    }

    private static func makeBatch(_ batch: Components.Schemas.CardPurchase) -> CardPurchase {
        CardPurchase(
            id: batch.id,
            condition: makeCondition(batch.condition),
            quantity: batch.quantity,
            purchasePrice: batch.purchasePrice.flatMap {
                Decimal(string: $0, locale: TCGLocales.decimal)
            },
            currency: batch.currency.flatMap { Currency(rawValue: $0.rawValue) },
            automaticPriceDate: batch.automaticPriceDate,
            displayPrice: batch.displayPrice.flatMap { display in
                Decimal(string: display.amount, locale: TCGLocales.decimal).map {
                    PurchaseDisplayPrice(
                        amount: $0,
                        currency: PricedCardMapper.makeCurrency(display.currency),
                        conversionUnavailable: display.conversionUnavailable
                    )
                }
            }
        )
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
