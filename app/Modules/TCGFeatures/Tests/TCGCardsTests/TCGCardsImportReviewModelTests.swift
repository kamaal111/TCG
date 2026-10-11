import Foundation
import HTTPTypes
import KamaalAuth
import OpenAPIRuntime
import Testing

@testable import TCGCards
@testable import TCGClient

@Suite("Cards Import Review Tests")
@MainActor
struct TCGCardsImportReviewModelTests {
    @Test
    func `Export retains the collection request failure in its result`() async {
        let feature = TCGCards(client: .preview(cardsOutcome: .serverUnavailable))
        #expect(await feature.exportCards() == .failure(.collection(.unknown(status: 503))))
    }

    @Test
    func `Preparing a review does not change the collection`() async throws {
        let feature = TCGCards(client: .preview(cardsOutcome: .empty))
        let model = makeModel()
        #expect(model.selectedCards.count == 1)
        #expect(model.selectedPurchaseCount == 2)
        #expect(feature.cards.isEmpty)
        #expect(model.completion == nil)
        #expect(model.canImport)
        try await feature.load(game: nil).get()
        #expect(feature.cards.isEmpty)
    }

    @Test
    func `Correcting a quantity includes the recovered purchase`() throws {
        let draft = CardsCSVFixtures.draft
        var row = try #require(draft.rows.first)
        row[.quantity] = "two"
        row.isIncluded = false
        let model = TCGCardsImportReviewModel(filename: "cards.csv", cards: [.init(id: draft.id, rows: [row])])
        #expect(model.selectedCards.isEmpty)
        row[.quantity] = "3"
        row.isIncluded = true
        model.saveRow(row, cardID: draft.id)
        #expect(model.selectedPurchaseCount == 1)
        #expect(model.selectedCards.first?.purchases.first?.quantity == 3)
        #expect(model.hasEdits)
    }

    @Test
    func `Removing a card disables an empty import`() throws {
        let model = makeModel()
        let id = try #require(model.cards.first).id
        model.removeCard(id: id)
        #expect(model.selectedCards.isEmpty)
        #expect(!model.canImport)
        #expect(model.removedCardCount == 1)
    }

    @Test
    func `Editing a card changes the draft only and clears changed cost provenance`() throws {
        let model = makeModel()
        let draft = try #require(model.cards.first)
        var values = CardFormValues(card: CardsCSVFixtures.card)
        values.name = "Edited Luffy"
        values.batches[0].priceText = "3.50"
        model.saveCard(values, id: draft.id)
        let edited = try #require(model.selectedCards.first)
        #expect(edited.name == "Edited Luffy")
        #expect(edited.createdAt == CardsCSVFixtures.date)
        #expect(edited.purchases.first?.purchasePrice == Decimal(string: "3.50"))
        #expect(edited.purchases.first?.automaticPriceDate == nil)
        #expect(model.completion == nil)
    }

    @Test
    func `Draft form saving validates without submitting`() throws {
        let form = TCGCardFormScreenModel(mode: .draft, initialValues: .init(card: CardsCSVFixtures.card))
        form.values.name = ""
        #expect(form.saveDraft() == nil)
        #expect(form.fieldErrors[.name] != nil)
        form.values.name = "Luffy"
        #expect(try #require(form.saveDraft()).name == "Luffy")
        #expect(form.savedCard == nil)
    }

    @Test
    func `Confirmed import refreshes and repeats safely`() async throws {
        let feature = TCGCards(client: .preview(cardsOutcome: .empty))
        let model = makeModel()
        await model.submit(using: feature)
        let completion = try #require(model.completion)
        #expect(completion.result.importedCount == 1)
        #expect(!completion.needsRefresh)
        #expect(feature.cards.count == 1)
        let repeated = makeModel()
        await repeated.submit(using: feature)
        #expect(repeated.completion?.result.skippedCount == 1)
        #expect(feature.cards.count == 1)
    }

    @Test
    func `Failed import keeps edits and explains safe retry`() async throws {
        let feature = TCGCards(client: .preview(cardsOutcome: .serverUnavailable))
        let model = makeModel()
        await model.submit(using: feature)
        #expect(model.completion == nil)
        #expect(try #require(model.submissionError).contains("Try again"))
        #expect(model.selectedCards.count == 1)
        #expect(model.canImport)
    }

    @Test
    func `A persisted import with a failed refresh offers refresh instead of import retry`() async throws {
        let transport = ImportRefreshTransport()
        let collection = try CSVImportTestClient.makeCollection(transport: transport)
        let model = makeModel()
        await model.submit(using: collection)
        let completion = try #require(model.completion)
        #expect(completion.result.importedCount == 1)
        #expect(completion.needsRefresh)
        #expect(model.submissionError == nil)
        #expect(!model.canImport)
        #expect(await transport.paths == ["/app-api/cards/import", "/app-api/cards"])
    }

    @Test
    func
        `The reported CSV survives file export and import with its blank date omitted and exact fractional timestamps`()
        async throws
    {
        let transport = CSVImportTransport(
            status: .ok,
            response: """
                {"imported_count": 0, "updated_count": 0, "skipped_count": 1}
                """
        )
        let drafts = try CardsCSV.parse(CardsCSVFixtures.reportedCSV).get()
        let source = TCGCardsImportReviewModel(filename: "reported.csv", cards: drafts)
        let exporter = TCGCards(client: .preview(cardsOutcome: .success(cards: source.selectedCards)))
        let file = try await exporter.exportCards().get()
        defer { try? FileManager.default.removeItem(at: file) }
        let model = TCGCardsImportReviewModel(url: file)
        #expect(model.fatalError == nil)
        #expect(model.selectedCards == source.selectedCards)

        let collection = try CSVImportTestClient.makeCollection(transport: transport)
        await model.submit(using: collection)
        #expect(model.completion?.result.skippedCount == 1)
        let data = try #require(await transport.importBody)
        let root = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        let cards = try #require(root["cards"] as? [[String: Any]])
        let card = try #require(cards.first)
        #expect(card["id"] as? String == "9ecb8b92-e1ad-4863-bd0e-7ca38210835b")
        #expect(card["name"] as? String == "イブキのカイリュー")
        #expect(card["set_name"] as? String == "ポケモンカード★VS")
        #expect(card["created_at"] as? String == "2026-10-13T19:32:58.959Z")
        #expect(card["updated_at"] as? String == "2026-10-13T19:32:59.788Z")
        let purchases = try #require(card["purchases"] as? [[String: Any]])
        let purchase = try #require(purchases.first)
        #expect(purchase["id"] as? String == "fd9bb814-18c4-464b-a7b2-bb303c19933d")
        #expect(purchase["purchase_price"] as? String == "180")
        #expect(purchase["currency"] as? String == "USD")
        #expect(purchase["automatic_price_date"] == nil)
    }

    @Test
    func
        `Indexed server validation highlights physical CSV lines after excluding earlier rows and clears after correction`()
        async throws
    {
        let response = """
            {
              "message": "Invalid payload", "code": "INVALID_PAYLOAD",
              "context": {"validations": [{
                "code": "custom", "path": ["cards", "0", "purchases", "0", "purchase_price"],
                "message": "Purchase price and currency must be provided together"
              }]}
            }
            """
        let transport = CSVImportTransport(status: .badRequest, response: response)
        var draft = CardsCSVFixtures.draft
        draft.rows[0].isIncluded = false
        let model = TCGCardsImportReviewModel(filename: "cards.csv", cards: [draft])
        await model.submit(using: try CSVImportTestClient.makeCollection(transport: transport))
        let issue = try #require(model.serverIssues.first)
        #expect(issue.row == 3)
        #expect(issue.column == .purchasePrice)
        let message = try #require(model.submissionError)
        #expect(message.contains("Row 3, purchase_price"))
        #expect(!message.localizedCaseInsensitiveContains("server"))
        #expect(!message.contains("HTTP"))
        #expect(model.selectedPurchaseCount == 1)
        #expect(model.completion == nil)
        var row = draft.rows[1]
        row[.purchasePrice] = "2.50"
        row[.currency] = "USD"
        model.saveRow(row, cardID: draft.id)
        #expect(model.serverIssues.isEmpty)
        #expect(model.submissionError == nil)
        #expect(model.canImport)
    }

    @Test
    func `Undecodable HTTP 400 preserves edits and explains rejection`() async throws {
        let transport = CSVImportTransport(status: .badRequest, response: "not JSON")
        let model = makeModel()
        let before = model.cards

        await model.submit(using: try CSVImportTestClient.makeCollection(transport: transport))

        let message = try #require(model.submissionError)
        #expect(!message.localizedCaseInsensitiveContains("server"))
        #expect(message.contains("couldn’t accept this import"))
        #expect(!message.contains("connected"))
        #expect(model.cards == before)
        #expect(model.completion == nil)
        #expect(model.canImport)
    }

    @Test
    func `Unreadable success response preserves edits without claiming connectivity failure`() async throws {
        let transport = CSVImportTransport(status: .ok, response: "{}")
        let model = makeModel()
        let before = model.cards

        await model.submit(using: try CSVImportTestClient.makeCollection(transport: transport))

        let message = try #require(model.submissionError)
        #expect(!message.localizedCaseInsensitiveContains("server"))
        #expect(message.contains("couldn’t read the import confirmation"))
        #expect(!message.contains("HTTP"))
        #expect(!message.contains("200"))
        #expect(!message.contains("connected"))
        #expect(model.cards == before)
        #expect(model.completion == nil)
        #expect(model.canImport)
    }

    @Test
    func `Request without a response preserves edits without displaying an invented status`() async throws {
        let transport = CSVImportTransport(status: .ok, response: "", fails: true)
        let model = makeModel()
        let before = model.cards

        await model.submit(using: try CSVImportTestClient.makeCollection(transport: transport))

        let message = try #require(model.submissionError)
        #expect(!message.localizedCaseInsensitiveContains("server"))
        #expect(message.contains("couldn’t get a response"))
        #expect(!message.contains("HTTP"))
        #expect(model.cards == before)
        #expect(model.completion == nil)
        #expect(model.canImport)
    }

    @Test
    func `HTTP 503 explains a server failure rather than an offline connection`() async throws {
        let transport = CSVImportTransport(status: .serviceUnavailable, response: "{}")
        let model = makeModel()

        await model.submit(using: try CSVImportTestClient.makeCollection(transport: transport))

        let message = try #require(model.submissionError)
        #expect(!message.localizedCaseInsensitiveContains("server"))
        #expect(message.contains("couldn’t complete your import"))
        #expect(!message.contains("HTTP"))
        #expect(!message.contains("503"))
        #expect(!message.contains("connected"))
        #expect(model.completion == nil)
        #expect(model.canImport)
    }

    @Test
    func `Preview import replaces changes and complete purchases without duplicating cards`() async throws {
        let collection = TCGCards(client: .preview(cardsOutcome: .empty))
        await makeModel().submit(using: collection)
        let changed = makeModel()
        let draft = try #require(changed.cards.first)
        var values = CardFormValues(card: CardsCSVFixtures.card)
        values.name = "Restored card"
        values.batches.removeLast()
        changed.saveCard(values, id: draft.id)
        await changed.submit(using: collection)
        #expect(changed.completion?.result.updatedCount == 1)
        #expect(collection.cards.count == 1)
        #expect(collection.cards.first?.card.name == "Restored card")
        #expect(collection.cards.first?.card.purchases.count == 1)
    }

    private func makeModel() -> TCGCardsImportReviewModel {
        .init(filename: "cards.csv", cards: [CardsCSVFixtures.draft])
    }
}

private actor ImportRefreshTransport: ClientTransport {
    private(set) var paths: [String] = []
    func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws -> (
        HTTPResponse, HTTPBody?
    ) {
        paths.append(request.path ?? "")
        if request.method == .post {
            return (
                HTTPResponse(status: .ok, headerFields: [.contentType: "application/json"]),
                HTTPBody(
                    """
                    {"imported_count":1,"updated_count":0,"skipped_count":0}
                    """
                )
            )
        }
        return (
            HTTPResponse(status: .serviceUnavailable, headerFields: [.contentType: "application/json"]),
            HTTPBody(
                """
                {"message":"Unavailable","code":"UNAVAILABLE"}
                """
            )
        )
    }
}
