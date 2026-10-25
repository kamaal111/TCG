import Foundation

enum CollectionMapper {
    static func makeSummary(
        _ collection: Components.Schemas.CardCollectionSummary
    ) -> Result<CardCollectionSummary, UUIDCodingError> {
        UUIDCoding.decode(collection.id)
            .map { id in
                CardCollectionSummary(
                    id: id,
                    name: collection.name,
                    isUnfiled: collection.isUnfiled,
                    revision: collection.revision
                )
            }
    }

    static func makeCollection(
        _ collection: Components.Schemas.CardCollection
    ) -> Result<CardBinderCollection, UUIDCodingError> {
        makeSummary(collection.value1)
            .flatMap { summary in
                ResultMapping.map(collection.value2.pages, transform: makePage)
                    .map { pages in
                        CardBinderCollection(
                            id: summary.id,
                            name: summary.name,
                            isUnfiled: summary.isUnfiled,
                            columns: collection.value2.columns,
                            rows: collection.value2.rows,
                            revision: summary.revision,
                            pages: pages
                        )
                    }
            }
    }

    static func makeLayout(_ collection: CardBinderCollection) -> Components.Schemas.SaveBinderLayout {
        .init(
            value1: makeGeneratedLayout(collection),
            value2: .init(revision: collection.revision)
        )
    }

    static func makeBackup(
        _ backup: Components.Schemas.CollectionBackup
    ) -> Result<CollectionBackup, CollectionsError> {
        guard let version = Int(exactly: backup.version) else { return .failure(.unavailable) }
        return ResultMapping.map(backup.collections, transform: makeCollection)
            .flatMap { collections in
                ResultMapping.map(backup.cards, transform: makeCard)
                    .map { cards in
                        CollectionBackup(version: version, collections: collections, cards: cards)
                    }
            }
            .mapError { _ in .unavailable }
    }

    static func makeGeneratedBackup(
        _ backup: CollectionBackup
    ) -> Result<Components.Schemas.ImportCollectionBackup, CollectionsError> {
        ResultMapping.map(backup.cards) { card -> Result<Components.Schemas.CollectionBackupCard, CollectionsError> in
            guard let collectionID = card.collectionID else { return .failure(.unavailable) }
            return .success(
                .init(
                    value1: TCGCardsClientImpl.makeGeneratedImportCard(card),
                    value2: .init(collectionId: UUIDCoding.encode(collectionID))
                )
            )
        }
        .map { cards in
            .init(
                version: Double(backup.version),
                collections: backup.collections.map(makeGeneratedCollection),
                cards: cards
            )
        }
    }

    private static func makePage(_ page: Components.Schemas.BinderPage) -> Result<BinderPage, UUIDCodingError> {
        UUIDCoding.decode(page.id)
            .flatMap { id in
                ResultMapping.map(page.slots) { slot in
                    UUIDCoding.decode(slot.cardId)
                        .map { cardID in
                            BinderSlot(row: slot.row, column: slot.column, cardID: cardID, quantity: slot.quantity)
                        }
                }
                .map { BinderPage(id: id, slots: $0) }
            }
    }

    private static func makeGeneratedPage(_ page: BinderPage) -> Components.Schemas.BinderPage {
        .init(
            id: UUIDCoding.encode(page.id),
            slots: page.slots.map { slot in
                .init(
                    row: slot.row,
                    column: slot.column,
                    cardId: UUIDCoding.encode(slot.cardID),
                    quantity: slot.quantity
                )
            }
        )
    }

    private static func makeGeneratedCollection(_ collection: CardBinderCollection) -> Components.Schemas.CardCollection
    {
        .init(
            value1: .init(
                id: UUIDCoding.encode(collection.id),
                name: collection.name,
                isUnfiled: collection.isUnfiled,
                revision: collection.revision
            ),
            value2: makeGeneratedLayout(collection)
        )
    }

    private static func makeGeneratedLayout(_ collection: CardBinderCollection) -> Components.Schemas.BinderLayout {
        .init(
            columns: collection.columns,
            rows: collection.rows,
            pages: collection.pages.map(makeGeneratedPage)
        )
    }

    private static func makeCard(
        _ card: Components.Schemas.CollectionBackupCard
    ) -> Result<ImportCardPayload, UUIDCodingError> {
        UUIDCoding.decode(card.value1.id)
            .flatMap { id in
                UUIDCoding.decode(card.value2.collectionId)
                    .flatMap { collectionID in
                        ResultMapping.map(card.value1.purchases, transform: makePurchase)
                            .map { purchases in
                                ImportCardPayload(
                                    id: id,
                                    collectionID: collectionID,
                                    game: makeGame(card.value1.game),
                                    name: card.value1.name,
                                    setName: card.value1.setName,
                                    cardNumber: card.value1.cardNumber,
                                    notes: card.value1.notes,
                                    createdAt: card.value1.createdAt,
                                    updatedAt: card.value1.updatedAt,
                                    purchases: purchases
                                )
                            }
                    }
            }
    }

    private static func makePurchase(
        _ purchase: Components.Schemas.ImportCard.PurchasesPayloadPayload
    ) -> Result<ImportPurchasePayload, UUIDCodingError> {
        UUIDCoding.decode(purchase.id)
            .map { id in
                ImportPurchasePayload(
                    id: id,
                    condition: makeCondition(purchase.condition),
                    quantity: purchase.quantity,
                    purchasePrice: purchase.purchasePrice,
                    currency: purchase.currency.flatMap(PricedCardMapper.makeCurrency),
                    automaticPriceDate: purchase.automaticPriceDate
                )
            }
    }

    private static func makeGame(_ game: Components.Schemas.ImportCard.GamePayload) -> ClientCardGame {
        switch game {
        case .onePiece: .onePiece
        case .pokemon: .pokemon
        }
    }

    private static func makeCondition(
        _ condition: Components.Schemas.ImportCard.PurchasesPayloadPayload.ConditionPayload
    ) -> CardCondition {
        switch condition {
        case .mint: .mint
        case .nearMint: .nearMint
        case .excellent: .excellent
        case .good: .good
        case .played: .played
        case .damaged: .damaged
        }
    }
}
