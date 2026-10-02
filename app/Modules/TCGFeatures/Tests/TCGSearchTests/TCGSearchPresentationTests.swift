import Foundation
import Testing

@testable import TCGClient
@testable import TCGSearch

@Suite("Search Presentation Tests")
@MainActor
struct TCGSearchPresentationTests {
    @Test
    func `Opening details retains the selected card after clearing search`() async throws {
        let feature = TCGSearch(client: .preview(pricingOutcome: .success))
        try await feature.search(game: .pokemon, query: "Giratina").get()
        let card = try #require(feature.results.first)
        let model = TCGSearchScreenModel()
        model.showDetails(of: card)
        feature.clear()
        #expect(model.presentedDetail == card)
        #expect(feature.results.isEmpty)
    }

    @Test
    func `Opening and closing the image preserves the selected detail`() {
        let model = TCGSearchScreenModel()
        model.showDetails(of: card)
        model.exploreImage(of: card)
        #expect(model.presentedImage == card)
        model.presentedImage = nil
        #expect(model.presentedDetail == card)
    }

    @Test
    func `Opening the image directly does not open details`() {
        let model = TCGSearchScreenModel()
        model.exploreImage(of: card)
        #expect(model.presentedImage == card)
        #expect(model.presentedDetail == nil)
    }

    @Test
    func `Missing artwork does not open exploration`() {
        let model = TCGSearchScreenModel()
        let card = PricedCard(
            id: "no-image", game: .onePiece, name: "Nami", cardNumber: "OP01-016",
            pricedOn: .distantPast, fetchedAt: .distantPast
        )
        model.exploreImage(of: card)
        #expect(model.presentedImage == nil)
    }

    private var card: PricedCard {
        PricedCard(
            id: "artwork", game: .pokemon, name: "Giratina", cardNumber: "186/196",
            imageURL: URL(string: "https://images.example.com/card.png")!,
            pricedOn: .distantPast, fetchedAt: .distantPast
        )
    }
}
