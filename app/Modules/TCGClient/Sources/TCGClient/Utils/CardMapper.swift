import Foundation
import TCGUtils

enum CardMapper {
    static func makeListQuery(_ query: ListCardsQuery) -> Operations.GetAppApiCards.Input.Query {
        .init(
            cursor: query.cursor,
            illustrator: query.filters.illustratorParameters,
            collectionId: query.collectionID.map(UUIDCoding.encode),
            query: query.query,
            game: query.game.map(Self.makeListGame),
            setName: query.filters.setNameParameters
        )
    }

    static func makeCollectionPage(
        _ collection: Components.Schemas.CardsListResponse
    ) -> Result<CardCollectionPage, UUIDCodingError> {
        makeOwnedDetails(collection.entries)
            .map { cards in
                CardCollectionPage(
                    cards: cards,
                    availableSetNames: Set(collection.availableSetNames),
                    nextCursor: collection.nextCursor,
                    availableIllustrators: Set(collection.availableIllustrators)
                )
            }
    }

    static func makeOwnedDetails(
        _ cards: [Components.Schemas.OwnedCardDetails]
    ) -> Result<[CardWithPrice], UUIDCodingError> {
        ResultMapping.map(cards, transform: Self.makeOwnedDetails)
    }

    static func makeCards(_ cards: [Components.Schemas.Card]) -> Result<[Card], UUIDCodingError> {
        ResultMapping.map(cards, transform: Self.makeCard)
    }

    static func makePriceRequest(_ ids: [UUID]) -> Components.Schemas.OwnedCardPricesRequest {
        .init(cardIds: ids.map(UUIDCoding.encode))
    }

    static func makePriceUpdates(
        _ result: Components.Schemas.OwnedCardPrices
    ) -> Result<[OwnedCardPriceUpdate], UUIDCodingError> {
        ResultMapping.map(result.prices, transform: Self.makePriceUpdate)
    }

    static func makeImportRequest(_ payload: ImportCardsPayload) -> Components.Schemas.ImportCards {
        .init(
            cards: payload.cards.map { card in
                .init(
                    notes: card.notes,
                    purchases: card.purchases.map(Self.makeImportPurchase),
                    id: UUIDCoding.encode(card.id),
                    createdAt: card.createdAt,
                    updatedAt: card.updatedAt,
                    pricedCardId: UUIDCoding.encode(card.pricedCardID)
                )
            }
        )
    }

    static func makeImportResult(_ result: Components.Schemas.ImportCardsResponse) -> ImportCardsResult {
        .init(
            importedCount: result.importedCount,
            updatedCount: result.updatedCount,
            skippedCount: result.skippedCount,
            allocationAdjustments: result.allocationAdjustments
        )
    }

    static func makeDeleteRequest(_ ids: [UUID]) -> Components.Schemas.DeleteCards {
        .init(cardIds: ids.map(UUIDCoding.encode))
    }

    static func makeDeleteResult(
        _ result: Components.Schemas.DeleteCardsResponse
    ) -> Result<DeleteCardsResult, UUIDCodingError> {
        ResultMapping.map(result.deletedIds, transform: UUIDCoding.decode)
            .flatMap { deletedIDs in
                ResultMapping.map(result.notFoundIds, transform: UUIDCoding.decode)
                    .map { notFoundIDs in
                        DeleteCardsResult(deletedIDs: deletedIDs, notFoundIDs: notFoundIDs)
                    }
            }
    }

    static func makeGeneratedImportCard(_ card: ImportCardPayload) -> Components.Schemas.ImportCard {
        .init(
            collectionId: card.collectionID.map(UUIDCoding.encode),
            notes: card.notes,
            purchases: card.purchases.map(Self.makeImportPurchase),
            id: UUIDCoding.encode(card.id),
            createdAt: card.createdAt,
            updatedAt: card.updatedAt,
            game: makeImportGame(card.game),
            name: card.name,
            setName: card.setName,
            cardNumber: card.cardNumber
        )
    }

    private static func makeImportGame(_ game: ClientCardGame) -> Components.Schemas.ImportCard.GamePayload {
        switch game {
        case .onePiece: .onePiece
        case .pokemon: .pokemon
        }
    }

    private static func makeImportPurchase(_ purchase: ImportPurchasePayload) -> Components.Schemas.ImportedCardPurchase
    {
        .init(
            id: UUIDCoding.encode(purchase.id),
            condition: makeImportCondition(purchase.condition),
            quantity: purchase.quantity,
            purchasePrice: purchase.purchasePrice,
            currency: purchase.currency.map(PricedCardMapper.generatedNullableCurrency),
            automaticPriceDate: purchase.automaticPriceDate
        )
    }

    private static func makeImportCondition(
        _ condition: CardCondition
    ) -> Components.Schemas.ImportedCardPurchase.ConditionPayload {
        switch condition {
        case .mint: .mint
        case .nearMint: .nearMint
        case .excellent: .excellent
        case .good: .good
        case .played: .played
        case .damaged: .damaged
        }
    }

    static func makeCreateRequest(_ payload: CreateCardPayload) -> Components.Schemas.CreateCard {
        .init(
            collectionId: payload.collectionID.map(UUIDCoding.encode),
            notes: payload.notes,
            purchases: payload.purchases.map(Self.makeGeneratedBatch),
            pricedCardId: UUIDCoding.encode(payload.pricedCardID)
        )
    }

    static func makeUpdateRequest(_ payload: UpdateCardPayload) -> Components.Schemas.UpdateCard {
        .init(
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

    private static func makePriceUpdate(
        _ update: Components.Schemas.OwnedCardPriceUpdate
    ) -> Result<OwnedCardPriceUpdate, UUIDCodingError> {
        let priceResult = PricedCardMapper.makeOwnedPrice(update.price)
        return priceResult.flatMap { price in
            guard price.cardId.uuidString.caseInsensitiveCompare(update.id) == .orderedSame else {
                return .failure(.invalidUUID(update.id))
            }

            let purchasesResult = ResultMapping.map(update.purchases, transform: Self.makeBatch)
            return purchasesResult.map { purchases in
                OwnedCardPriceUpdate(
                    updatedAt: update.updatedAt,
                    price: price,
                    displayCurrency: update.displayCurrency.map(PricedCardMapper.makeCurrency),
                    illustrator: update.illustrator,
                    purchasePriceChangePercent: update.purchasePriceChangePercent,
                    purchases: purchases
                )
            }
        }
    }

    static func makeOwnedDetails(_ details: Components.Schemas.OwnedCardDetails) -> Result<
        CardWithPrice, UUIDCodingError
    > {
        let cardResult = makeCard(details.value1)
        return cardResult.map { card in
            CardWithPrice(
                card: card,
                price: .init(cardId: card.id, status: .pending, price: nil),
                imageURL: details.value2.artworkUrl.flatMap(URL.init(string:))
            )
        }
    }

    static func makeCardWithPrice(
        _ cardWithPrice: Components.Schemas.CardWithPrice
    ) -> Result<CardWithPrice, UUIDCodingError> {
        makeCard(cardWithPrice.value1)
            .flatMap { card in
                PricedCardMapper.makeOwnedPrice(cardWithPrice.value2.price)
                    .map { price in
                        CardWithPrice(card: card, price: price, imageURL: nil)
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
                                    allocationAdjustments: card.allocationAdjustments,
                                    illustrator: card.illustrator,
                                    englishSearchAlias: card.englishSearchAlias
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

    private static func makeGame(_ game: Components.Schemas.Card.GamePayload) -> ClientCardGame {
        switch game {
        case .onePiece: .onePiece
        case .pokemon: .pokemon
        }
    }
}
