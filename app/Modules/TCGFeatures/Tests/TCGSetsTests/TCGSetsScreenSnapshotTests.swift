import SwiftUI
import TCGDesignSystem
import TCGListSupport
import TCGSnapshotTesting
import Testing

@testable import TCGClient
@testable import TCGSets

@Suite("Sets Screen Snapshots", .serialized)
@MainActor
struct TCGSetsScreenSnapshotTests {
    private let ascendedHeroes = CatalogSetSummary(
        set: .init(id: "me2pt5", name: "Ascended Heroes"),
        logo: nil,
        symbol: nil,
        language: "en",
        progress: .init(collected: 184, total: 295)
    )

    @Test
    func `Shows progress in the set browser`() async {
        let model = TCGSetsScreenModel(debounce: .zero)
        let sets = TCGSets(client: SetsSnapshotClient(ascendedHeroes: ascendedHeroes))
        await model.search(model.request(game: .pokemon, collectionRevision: 0), using: sets)
        #expect(model.page(for: .all).entries.map(\.id) == ["me3", "me2pt5"])
        await assertScreenSnapshot(
            testName: #function,
            fileID: #fileID,
            file: #filePath,
            line: #line,
            column: #column
        ) {
            TCGSetsScreen(
                gameSelection: TCGGameSelection(preferences: nil),
                path: .constant([]),
                isVisible: false,
                collectionRevision: 0,
                model: model,
                onWishlistMembershipChange: { _, _ in }
            ) { _, _ in EmptyView() }
            .tcgSets(sets)
            .environment(\.tcgSettingsPresentation, .constant(false))
        }
    }

    @Test
    func `Shows owned and missing cards in collector order`() async {
        let imageURL = URL(string: "https://example.com/preview.png")
        let cards: [CatalogSetCard] = [
            .init(number: "1", printedNumber: "001/217", name: "Erika’s Oddish", imageURL: imageURL, owned: true),
            .init(number: "2", printedNumber: "002/217", name: "Erika’s Gloom", imageURL: imageURL, owned: false),
            .init(number: "3", printedNumber: "003/217", name: "Erika’s Vileplume ex", imageURL: nil, owned: true),
        ]
        await assertScreenSnapshot(
            testName: #function,
            fileID: #fileID,
            file: #filePath,
            line: #line,
            column: #column
        ) {
            NavigationStack {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        SetChecklistHeader(summary: ascendedHeroes, filter: .constant(.all))
                        SetChecklistGrid(cards: cards) { _ in }
                    }
                    .padding()
                }
                .navigationTitle(ascendedHeroes.set.name)
            }
            .cardImageLoader(PreviewCardImageLoader(outcome: .success))
        }
    }
}

private struct SetsSnapshotClient: TCGSetsClient {
    let ascendedHeroes: CatalogSetSummary

    func list(
        game: ClientCardGame,
        query: String?,
        inProgress: Bool,
        cursor: String?
    ) async -> Result<CatalogSetPage<CatalogSetSummary>, CatalogSetsError> {
        if inProgress {
            return .success(.init(entries: [ascendedHeroes], nextCursor: nil))
        }
        let perfectOrder = CatalogSetSummary(
            set: .init(id: "me3", name: "Perfect Order"),
            logo: nil,
            symbol: nil,
            language: "en",
            progress: .init(collected: 0, total: 124)
        )
        return .success(.init(entries: [perfectOrder, ascendedHeroes], nextCursor: nil))
    }

    func checklist(
        game: ClientCardGame,
        setID: String,
        filter: CatalogChecklistFilter,
        cursor: String?
    ) async -> Result<CatalogChecklistPage, CatalogSetsError> {
        .failure(.unavailable)
    }

    func detail(
        game: ClientCardGame,
        setID: String,
        number: String
    ) async -> Result<[PricedCard], CatalogSetsError> {
        .failure(.unavailable)
    }
}
