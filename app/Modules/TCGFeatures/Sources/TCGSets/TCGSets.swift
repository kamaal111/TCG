import Observation
import SwiftUI
import TCGCardDetails
import TCGClient

@MainActor
@Observable
public final class TCGSets {
    private let client: TCGSetsClient

    public init(client: TCGSetsClient) {
        self.client = client
    }

    func list(
        game: ClientCardGame,
        query: String?,
        inProgress: Bool,
        cursor: String?
    ) async -> Result<CatalogSetPage<CatalogSetSummary>, CatalogSetsError> {
        await client.list(game: game, query: query, inProgress: inProgress, cursor: cursor)
    }

    func checklist(
        for destination: CatalogSetDestination,
        filter: CatalogChecklistFilter,
        cursor: String?
    ) async -> Result<CatalogChecklistPage, CatalogSetsError> {
        await client.checklist(game: destination.game, setID: destination.set.id, filter: filter, cursor: cursor)
    }

    func detail(for card: CatalogSetCard, in destination: CatalogSetDestination) async -> CardVariantGroup? {
        let result = await client.detail(game: destination.game, setID: destination.set.id, number: card.number)
        guard case .success(let printings) = result, let first = printings.first else { return nil }
        return CardVariantGroup(card: first, variants: printings)
    }
}

extension View {
    public func tcgSets(_ sets: TCGSets) -> some View { environment(sets) }
}
