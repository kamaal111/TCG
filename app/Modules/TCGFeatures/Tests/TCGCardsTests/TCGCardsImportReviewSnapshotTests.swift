import SwiftUI
import TCGSnapshotTesting
import Testing

@testable import TCGCards
@testable import TCGClient

@Suite("Cards Import Review Snapshot Tests")
@MainActor
struct TCGCardsImportReviewSnapshotTests {
    @Test
    func `Renders a clean editable review`() async {
        let model = TCGCardsImportReviewModel(filename: "my-cards.csv", cards: [CardsCSVFixtures.draft])
        #expect(model.selectedPurchaseCount == 2)
        await assertScreenSnapshot(testName: #function) {
            TCGCardsImportReviewScreen(model: model).tcgCards(TCGCards(client: .preview(cardsOutcome: .empty)))
        }
    }

    @Test
    func `Renders actionable purchase errors`() async {
        var draft = CardsCSVFixtures.draft
        draft.rows[0][.quantity] = "two"
        draft.rows[0].isIncluded = false
        let model = TCGCardsImportReviewModel(filename: "my-cards.csv", cards: [draft])
        #expect(model.invalidRowCount == 1)
        await assertScreenSnapshot(testName: #function) {
            TCGCardsImportReviewScreen(model: model).tcgCards(TCGCards(client: .preview(cardsOutcome: .empty)))
        }
    }

    @Test
    func `Renders import completion counts`() async {
        let model = TCGCardsImportReviewModel(filename: "my-cards.csv", cards: [CardsCSVFixtures.draft])
        model.completion = .init(
            result: .init(
                importedCount: 1,
                updatedCount: 3,
                skippedCount: 2,
                allocationAdjustments: nil
            ),
            needsRefresh: false
        )
        #expect(model.completion?.result.importedCount == 1)
        await assertScreenSnapshot(testName: #function) {
            TCGCardsImportReviewScreen(model: model).tcgCards(TCGCards(client: .preview(cardsOutcome: .empty)))
        }
    }

    @Test
    func `Renders indexed server validation errors`() async {
        let issue = TCGClientValidationIssue(
            code: "invalid_format",
            path: ["cards", "0", "purchases", "0", "automatic_price_date"],
            message: "Invalid ISO date"
        )
        let collection = TCGCards(client: .preview(cardsOutcome: .validationErrors([issue])))
        let model = TCGCardsImportReviewModel(filename: "my-cards.csv", cards: [CardsCSVFixtures.draft])
        await model.submit(using: collection)
        #expect(model.serverIssues.first?.row == 2)
        await assertScreenSnapshot(testName: #function) {
            TCGCardsImportReviewScreen(model: model).tcgCards(collection)
        }
    }

    @Test
    func `Renders an import rejection when the response cannot be decoded`() async throws {
        let transport = CSVImportTransport(status: .badRequest, response: "not JSON")
        let collection = try CSVImportTestClient.makeCollection(transport: transport)
        let model = TCGCardsImportReviewModel(filename: "my-cards.csv", cards: [CardsCSVFixtures.draft])
        await model.submit(using: collection)
        #expect(model.submissionError?.contains("couldn’t accept this import") == true)
        await assertScreenSnapshot(testName: #function) {
            TCGCardsImportReviewScreen(model: model).tcgCards(collection)
        }
    }

    @Test
    func `Renders an unreadable import result without connection advice`() async throws {
        let transport = CSVImportTransport(status: .ok, response: "{}")
        let collection = try CSVImportTestClient.makeCollection(transport: transport)
        let model = TCGCardsImportReviewModel(filename: "my-cards.csv", cards: [CardsCSVFixtures.draft])
        await model.submit(using: collection)
        #expect(model.submissionError?.contains("couldn’t read the import confirmation") == true)
        await assertScreenSnapshot(testName: #function) {
            TCGCardsImportReviewScreen(model: model).tcgCards(collection)
        }
    }

    @Test
    func `Renders the draft card editor`() async {
        let model = TCGCardFormScreenModel(mode: .draft, initialValues: .init(card: CardsCSVFixtures.card))
        #expect(model.values.batches.count == 2)
        await assertScreenSnapshot(testName: #function) {
            NavigationStack {
                ScrollView { TCGCardFormFields(model: model, onSubmit: {}) }
                    .navigationTitle(Text("Edit Import Card"))
            }
            .tcgCards(TCGCards(client: .preview(cardsOutcome: .empty)))
        }
    }
}
