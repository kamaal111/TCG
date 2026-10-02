//
//  TCGCardFormScreenModelTests.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/20/26.
//

import Foundation
import HTTPTypes
import KamaalAuth
import OpenAPIRuntime
import Testing

@testable import TCGCards
@testable import TCGClient

@Suite("TCGCard Form Screen Model Tests")
@MainActor
struct TCGCardFormScreenModelTests {
    @Test(arguments: PreviewTCGPricingClient.samplePricedCards)
    func `Searched cards prefill details with empty quantities and notes`(card: PricedCard) {
        let model = TCGCardFormScreenModel(mode: .add, initialValues: .init(pricedCard: card))
        #expect(model.values.game == card.game)
        #expect(model.values.name == card.name)
        #expect(model.values.setName == card.setName)
        #expect(model.values.cardNumber == card.cardNumber)
        #expect(model.values.quantities.isEmpty)
        #expect(model.values.notes.isEmpty)
    }

    @Test(arguments: PreviewTCGPricingClient.samplePricedCards)
    func `Searched card details are the dismissal baseline`(card: PricedCard) {
        let model = TCGCardFormScreenModel(mode: .add, initialValues: .init(pricedCard: card))
        #expect(!model.hasUnsavedChanges)
        #expect(model.requestDismissal())
        model.values.name = "Edited name"
        #expect(!model.requestDismissal())
        #expect(model.isShowingDiscardConfirmation)
        model.keepEditing()
        model.values.name = card.name
        #expect(!model.hasUnsavedChanges)
        #expect(model.requestDismissal())
    }

    @Test(arguments: PreviewTCGPricingClient.samplePricedCards)
    func `Searched cards require a quantity before saving`(card: PricedCard) async {
        let model = TCGCardFormScreenModel(mode: .add, initialValues: .init(pricedCard: card))
        let collection = TCGCards(client: .preview(cardsOutcome: .empty))
        #expect(!(await model.submit(using: collection)))
        #expect(Set(model.fieldErrors.keys) == [.quantities])
        #expect(collection.cards.isEmpty)
    }

    @Test
    func `Missing searched set remains required and can be supplied`() async {
        let card = PricedCard(
            id: "missing-set", game: .pokemon, name: "Pikachu", cardNumber: "58/102",
            pricedOn: .distantPast, fetchedAt: .distantPast)
        let model = TCGCardFormScreenModel(mode: .add, initialValues: .init(pricedCard: card))
        let collection = TCGCards(client: .preview(cardsOutcome: .empty))
        model.values.quantities = [.nearMint: 1]
        #expect(model.values.setName.isEmpty)
        #expect(!(await model.submit(using: collection)))
        #expect(Set(model.fieldErrors.keys) == [.setName])
        model.values.setName = "Base Set"
        #expect(await model.submit(using: collection))
        #expect(collection.cards.first?.card.setName == "Base Set")
    }

    @Test(arguments: PreviewTCGPricingClient.samplePricedCards)
    func `Prefilled add saves edited details quantities and notes`(card: PricedCard) async throws {
        let model = TCGCardFormScreenModel(mode: .add, initialValues: .init(pricedCard: card))
        let collection = TCGCards(client: .preview(cardsOutcome: .empty))
        model.values.name = "Corrected name"
        model.values.quantities = [.nearMint: 2, .played: 1]
        model.values.notes = "  My notes  "
        #expect(await model.submit(using: collection))
        let saved = try #require(collection.cards.first?.card)
        #expect(saved.game == card.game)
        #expect(saved.name == "Corrected name")
        #expect(saved.setName == card.setName)
        #expect(saved.cardNumber == card.cardNumber)
        #expect(saved.notes == "My notes")
        #expect(
            Set(saved.quantities)
                == Set([
                    CardConditionQuantity(condition: .nearMint, quantity: 2),
                    CardConditionQuantity(condition: .played, quantity: 1),
                ]))
    }

    @Test
    func `Prefilled add retains values after server failure`() async {
        let model = TCGCardFormScreenModel(
            mode: .add,
            initialValues: .init(pricedCard: PreviewTCGPricingClient.samplePricedCards[0]))
        model.values.quantities = [.nearMint: 1]
        model.values.notes = "Keep this draft"
        let values = model.values
        #expect(!(await model.submit(using: TCGCards(client: .preview(cardsOutcome: .serverUnavailable)))))
        #expect(model.values == values)
        #expect(model.toast != nil)
        #expect(!model.isSubmitting)
    }

    @Test
    func `Unchanged add and edit forms dismiss without confirmation`() {
        let add = TCGCardFormScreenModel(mode: .add, initialValues: nil)
        let edit = TCGCardFormScreenModel(mode: .edit(PreviewTCGCardsClient.sampleCards[0]), initialValues: nil)
        #expect(add.requestDismissal())
        #expect(edit.requestDismissal())
        #expect(!add.isShowingDiscardConfirmation)
        #expect(!edit.isShowingDiscardConfirmation)
    }

    @Test(arguments: ChangedTextField.allCases)
    func `Changed text fields require discard confirmation`(field: ChangedTextField) {
        let model = TCGCardFormScreenModel(mode: .add, initialValues: nil)
        model.values[keyPath: field.keyPath] = "Draft"
        #expect(model.hasUnsavedChanges)
        #expect(!model.requestDismissal())
        #expect(model.isShowingDiscardConfirmation)
    }

    @Test
    func `Changed game requires discard confirmation`() {
        let model = TCGCardFormScreenModel(mode: .add, initialValues: nil)
        model.values.game = .pokemon
        #expect(model.hasUnsavedChanges)
        #expect(!model.requestDismissal())
        #expect(model.isShowingDiscardConfirmation)
    }

    @Test
    func `Changed edit quantity requires discard confirmation`() {
        let model = TCGCardFormScreenModel(mode: .edit(PreviewTCGCardsClient.sampleCards[0]), initialValues: nil)
        model.values.quantities[.nearMint] = 3
        #expect(model.hasUnsavedChanges)
        #expect(!model.requestDismissal())
        #expect(model.isShowingDiscardConfirmation)
    }

    @Test
    func `Restoring every field permits immediate dismissal`() {
        let model = TCGCardFormScreenModel(mode: .edit(PreviewTCGCardsClient.sampleCards[0]), initialValues: nil)
        let original = model.values
        model.values = validValues
        #expect(model.hasUnsavedChanges)
        model.values = original
        #expect(!model.hasUnsavedChanges)
        #expect(model.requestDismissal())
    }

    @Test
    func `Zero quantities match missing quantities`() {
        let model = TCGCardFormScreenModel(mode: .add, initialValues: nil)
        model.values.quantities[.nearMint] = 1
        #expect(model.hasUnsavedChanges)
        model.values.quantities[.nearMint] = 0
        #expect(!model.hasUnsavedChanges)
        #expect(model.requestDismissal())
    }

    @Test
    func `Keeping edits preserves the draft and validation errors`() async {
        let model = TCGCardFormScreenModel(mode: .add, initialValues: nil)
        model.values.name = "Draft"
        let submitted = await model.submit(using: TCGCards(client: .preview(cardsOutcome: .empty)))
        #expect(!submitted)
        let draft = model.values
        let errors = model.fieldErrors
        let toast = model.toast
        #expect(!model.requestDismissal())
        model.keepEditing()
        #expect(!model.isShowingDiscardConfirmation)
        #expect(model.values == draft)
        #expect(model.fieldErrors == errors)
        #expect(model.toast == toast)
    }

    @Test
    func `Dismissal is blocked during submission and a failed save preserves edits`() async throws {
        let transport = PendingCardSubmissionTransport()
        let credentials = Credentials(
            authToken: "auth-token", authTokenExpiryDate: .distantFuture,
            sessionToken: "session-token", sessionUpdateAge: 1800, lastSessionUpdate: .now
        )
        let client = TCGClient.default(
            transport: transport, credentialsKeychainKey: "card-form-dismissal-test",
            credentialsStore: InMemoryCredentialsStore(seed: try JSONEncoder().encode(credentials))
        )
        let model = TCGCardFormScreenModel(mode: .add, initialValues: nil)
        model.values = validValues
        let submission = Task { await model.submit(using: TCGCards(client: client)) }
        await transport.waitForRequest()
        #expect(model.isSubmitting)
        #expect(!model.requestDismissal())
        #expect(!model.isShowingDiscardConfirmation)
        await transport.failRequest()
        let submitted = await submission.value
        #expect(!submitted)
        #expect(!model.isSubmitting)
        #expect(model.values == validValues)
        #expect(model.hasUnsavedChanges)
        #expect(!model.requestDismissal())
        #expect(model.isShowingDiscardConfirmation)
    }

    @Test
    func `Empty fields and quantities are validated`() async {
        let model = TCGCardFormScreenModel(mode: .add, initialValues: nil)
        let submitted = await model.submit(using: TCGCards(client: .preview(cardsOutcome: .empty)))
        #expect(!submitted)
        #expect(model.fieldErrors[.name] != nil)
        #expect(model.fieldErrors[.setName] != nil)
        #expect(model.fieldErrors[.cardNumber] != nil)
        #expect(model.fieldErrors[.quantities] != nil)
        #expect(!model.isSubmitting)
    }

    @Test
    func `Valid add submits successfully`() async {
        let model = TCGCardFormScreenModel(mode: .add, initialValues: nil)
        model.values = validValues
        #expect(await model.submit(using: TCGCards(client: .preview(cardsOutcome: .empty))))
        #expect(!model.isSubmitting)
    }

    @Test
    func `Edit prefills every card value`() {
        let card = PreviewTCGCardsClient.sampleCards[0]
        let model = TCGCardFormScreenModel(mode: .edit(card), initialValues: nil)
        #expect(model.values.name == card.name)
        #expect(model.values.quantities[.nearMint] == 2)
    }

    @Test
    func `Server validation maps set name and unavailable sets toast`() async {
        let issue = TCGClientValidationIssue(code: "too_small", path: ["set_name"], message: "Required")
        let validationModel = TCGCardFormScreenModel(mode: .add, initialValues: nil)
        validationModel.values = validValues
        _ = await validationModel.submit(
            using: TCGCards(client: .preview(cardsOutcome: .validationErrors([issue])))
        )
        #expect(validationModel.fieldErrors[.setName] == "Required")

        let unavailableModel = TCGCardFormScreenModel(mode: .add, initialValues: nil)
        unavailableModel.values = validValues
        _ = await unavailableModel.submit(using: TCGCards(client: .preview(cardsOutcome: .serverUnavailable)))
        #expect(unavailableModel.toast != nil)
        #expect(!unavailableModel.isSubmitting)
    }

    enum ChangedTextField: CaseIterable, Sendable {
        case name, setName, cardNumber, notes

        var keyPath: WritableKeyPath<CardFormValues, String> {
            switch self {
            case .name: \CardFormValues.name
            case .setName: \CardFormValues.setName
            case .cardNumber: \CardFormValues.cardNumber
            case .notes: \CardFormValues.notes
            }
        }
    }
}

private actor PendingCardSubmissionTransport: ClientTransport {
    private var hasStarted = false
    private var waitingForRequest: CheckedContinuation<Void, Never>?
    private var response: CheckedContinuation<(HTTPResponse, HTTPBody?), Never>?

    func send(
        _ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        await withCheckedContinuation { continuation in
            response = continuation
            hasStarted = true
            waitingForRequest?.resume()
            waitingForRequest = nil
        }
    }

    func waitForRequest() async {
        guard !hasStarted else { return }
        await withCheckedContinuation { waitingForRequest = $0 }
    }

    func failRequest() {
        guard let response else { preconditionFailure("A submission must be pending.") }
        self.response = nil
        response.resume(returning: (HTTPResponse(status: .serviceUnavailable), nil))
    }
}
