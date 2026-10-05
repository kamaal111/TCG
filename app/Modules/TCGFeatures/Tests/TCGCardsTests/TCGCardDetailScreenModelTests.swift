import Foundation
import HTTPTypes
import KamaalAuth
import OpenAPIRuntime
import Testing

@testable import TCGCards
@testable import TCGClient

@Suite("Collection Detail Screen Model Tests")
@MainActor
struct TCGCardDetailScreenModelTests {
    @Test
    func `Editing a card out of the selected set keeps updated details and refreshes the filtered list`() async throws {
        let feature = TCGCards(client: .preview(cardsOutcome: .success(cards: PreviewTCGCardsClient.sampleCards)))
        try await feature.load(game: .pokemon, setNames: ["Base Set"]).get()
        let model = TCGCardDetailScreenModel(card: try #require(feature.cards.first))
        model.edit()
        let editor = try #require(model.editor)
        editor.values.setName = "Crown Zenith"

        await model.save(using: feature)

        #expect(model.editor == nil)
        #expect(model.card.card.setName == "Crown Zenith")
        #expect(feature.cards.isEmpty)
        #expect(feature.availableSetNames == ["Crown Zenith"])
    }

    @Test
    func `Details start read only and edit prefills every value`() throws {
        let model = makeModel()
        #expect(model.editor == nil)
        model.edit()
        let editor = try #require(model.editor)
        #expect(editor.values == CardFormValues(card: model.card.card))
        #expect(!editor.hasUnsavedChanges)
        #expect(editor.requestDismissal())
        editor.values.notes = "Draft"
        model.edit()
        #expect(model.editor === editor)
        #expect(editor.values.notes == "Draft")
    }

    @Test
    func `Saving returns to updated details and resets the next edit baseline`() async throws {
        let feature = TCGCards(client: .preview(cardsOutcome: .success(cards: PreviewTCGCardsClient.sampleCards)))
        try await feature.load(game: nil).get()
        let model = TCGCardDetailScreenModel(card: try #require(feature.cards.first))
        model.edit()
        let editor = try #require(model.editor)
        editor.values.name = "Updated card"
        editor.values.notes = "  Saved note  "
        editor.values.quantities = [.nearMint: 3]
        await model.save(using: feature)
        #expect(model.editor == nil)
        #expect(model.card == feature.cards.first)
        #expect(model.card.card.name == "Updated card")
        #expect(model.card.card.notes == "Saved note")
        #expect(model.card.card.quantities == [.init(condition: .nearMint, quantity: 3)])
        model.edit()
        let nextEditor = try #require(model.editor)
        #expect(nextEditor.values.name == "Updated card")
        #expect(nextEditor.values.notes == "Saved note")
        #expect(!nextEditor.hasUnsavedChanges)
        #expect(nextEditor.requestDismissal())
    }

    @Test
    func `Invalid save keeps the draft and existing details`() async throws {
        let model = makeModel()
        let original = model.card
        model.edit()
        let editor = try #require(model.editor)
        editor.values.name = ""
        await model.save(using: TCGCards(client: .preview(cardsOutcome: .empty)))
        #expect(model.editor === editor)
        #expect(editor.values.name.isEmpty)
        #expect(editor.fieldErrors[.name] != nil)
        #expect(model.card == original)
        #expect(!editor.requestDismissal())
        #expect(editor.isShowingDiscardConfirmation)
        editor.keepEditing()
        #expect(!editor.isShowingDiscardConfirmation)
    }

    @Test
    func `Failed save keeps edits and error feedback`() async throws {
        let model = makeModel()
        let original = model.card
        model.edit()
        let editor = try #require(model.editor)
        editor.values.notes = "Draft"
        await model.save(using: TCGCards(client: .preview(cardsOutcome: .serverUnavailable)))
        #expect(model.editor === editor)
        #expect(editor.values.notes == "Draft")
        #expect(editor.toast != nil)
        #expect(model.card == original)
    }

    @Test
    func `Repeated save and dismissal are blocked while submission is pending`() async throws {
        let transport = PendingDetailSaveTransport()
        let credentials = Credentials(
            authToken: "auth-token", authTokenExpiryDate: .distantFuture,
            sessionToken: "session-token", sessionUpdateAge: 1800, lastSessionUpdate: .distantPast
        )
        let client = TCGClient.default(
            transport: transport, credentialsKeychainKey: "detail-save-test",
            credentialsStore: InMemoryCredentialsStore(seed: try JSONEncoder().encode(credentials))
        )
        let feature = TCGCards(client: client)
        let model = makeModel()
        model.edit()
        let editor = try #require(model.editor)
        editor.values.notes = "Draft"
        let submission = Task { await model.save(using: feature) }
        await transport.waitForRequest()
        #expect(editor.isSubmitting)
        #expect(!editor.requestDismissal())
        await model.save(using: feature)
        #expect(await transport.requestCount == 1)
        await transport.failRequest()
        await submission.value
        #expect(model.editor === editor)
        #expect(!editor.isSubmitting)
        #expect(editor.values.notes == "Draft")
    }

    @Test
    func `Image exploration preserves collection details`() throws {
        let model = TCGCardsListScreenModel()
        let card = makeModel().card
        model.showDetails(of: card)
        model.exploreImage(of: card)
        #expect(model.presentedImageURL == card.price.price?.imageURL)
        model.presentedImageURL = nil
        let route = try #require(model.presentedForm)
        #expect(route.id == card.card.id)
    }

    @Test
    func `Missing artwork does not open image exploration`() {
        let model = TCGCardsListScreenModel()
        let card = PreviewTCGCardsClient.sampleCards[0]
        model.exploreImage(of: .init(card: card, price: .init(cardId: card.id, status: .noMatch)))
        #expect(model.presentedImageURL == nil)
        #expect(model.presentedForm == nil)
    }

    private func makeModel() -> TCGCardDetailScreenModel {
        let card = PreviewTCGCardsClient.sampleCards[0]
        return .init(card: .init(card: card, price: PreviewTCGCardsClient.price(for: card)))
    }
}

private actor PendingDetailSaveTransport: ClientTransport {
    private(set) var requestCount = 0
    private var waitingForRequest: CheckedContinuation<Void, Never>?
    private var response: CheckedContinuation<(HTTPResponse, HTTPBody?), Never>?

    func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws -> (
        HTTPResponse, HTTPBody?
    ) {
        requestCount += 1
        return await withCheckedContinuation { continuation in
            response = continuation
            waitingForRequest?.resume()
            waitingForRequest = nil
        }
    }

    func waitForRequest() async {
        guard requestCount == 0 else { return }
        await withCheckedContinuation { waitingForRequest = $0 }
    }

    func failRequest() {
        guard let response else { preconditionFailure("A detail save must be pending.") }
        self.response = nil
        response.resume(returning: (HTTPResponse(status: .serviceUnavailable), nil))
    }
}
