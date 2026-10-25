import Foundation

@testable import TCGClient

enum ClientCardFixtures {
    static func card(id: UUID, setName: String? = nil, createdAt: Date? = nil) -> Card {
        let original = PreviewTCGCardsClient.sampleCards[0]
        return Card(
            id: id,
            game: original.game,
            name: original.name,
            setName: setName ?? original.setName,
            cardNumber: original.cardNumber,
            notes: original.notes,
            createdAt: createdAt ?? original.createdAt,
            updatedAt: original.updatedAt,
            purchases: original.purchases,
            collectionID: original.collectionID,
            allocationAdjustments: nil
        )
    }
}
