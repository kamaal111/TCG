import Foundation

struct PreviewTCGSetsClient: TCGSetsClient {
    func list(
        game: ClientCardGame,
        query: String?,
        inProgress: Bool,
        cursor: String?
    ) async -> Result<CatalogSetPage<CatalogSetSummary>, CatalogSetsError> {
        guard !inProgress, cursor == nil, let set = Self.sample(for: game) else {
            return .success(.init(entries: [], nextCursor: nil))
        }
        let query = query?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let matches =
            query.isEmpty
            || set.summary.set.name.localizedCaseInsensitiveContains(query)
            || set.summary.id.localizedCaseInsensitiveContains(query)
        return .success(.init(entries: matches ? [set.summary] : [], nextCursor: nil))
    }

    func checklist(
        game: ClientCardGame,
        setID: String,
        filter: CatalogChecklistFilter,
        cursor: String?
    ) async -> Result<CatalogChecklistPage, CatalogSetsError> {
        guard let set = Self.sample(for: game), set.summary.id == setID else { return .failure(.notFound) }
        let cards = filter != .owned && cursor == nil ? [set.card] : []
        return .success(.init(cards: .init(entries: cards, nextCursor: nil), set: set.summary))
    }

    func detail(
        game: ClientCardGame,
        setID: String,
        number: String
    ) async -> Result<[PricedCard], CatalogSetsError> {
        guard let set = Self.sample(for: game), set.summary.id == setID, set.card.number == number else {
            return .failure(.notFound)
        }
        return .success([set.printing])
    }

    private static func sample(for game: ClientCardGame) -> (
        summary: CatalogSetSummary, card: CatalogSetCard, printing: PricedCard
    )? {
        guard let printing = PreviewTCGPricingClient.samplePricedCards.first(where: { $0.game == game }),
            let name = printing.setName
        else { return nil }
        let id = game == .pokemon ? "swsh12pt5" : "op09"
        let summary = CatalogSetSummary(
            set: .init(id: id, name: name),
            logo: nil,
            symbol: nil,
            language: "en",
            progress: .init(collected: 0, total: 1)
        )
        let card = CatalogSetCard(
            number: printing.cardNumber,
            printedNumber: printing.cardNumber,
            name: printing.name,
            imageURL: printing.imageURL,
            owned: false
        )
        return (summary, card, printing)
    }
}
