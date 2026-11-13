import Foundation
import Testing

@testable import TCGClient
@testable import TCGSearch

@Suite("Search Presentation Tests")
@MainActor
struct TCGSearchPresentationTests {
    @Test
    func `Opening details retains the selected card after clearing search`() async throws {
        let feature = TCGSearch(client: .preview(pricingOutcome: .success), history: TCGSearchHistoryStore())
        try await feature.search(.init(game: .pokemon, query: "Giratina", languages: [], mode: .card, cursor: nil))
            .get()
        let card = try #require(feature.results.first)
        let model = TCGSearchScreenModel(preferences: nil)
        model.showDetails(of: .init(card: card, variants: [card]))
        feature.clear()
        #expect(model.presentedDetail?.card == card)
        #expect(feature.results.isEmpty)
    }

    @Test
    func `Opening and closing the image preserves the selected detail`() {
        let model = TCGSearchScreenModel(preferences: nil)
        model.showDetails(of: .init(card: card, variants: [card]))
        model.exploreImage(of: .init(card: card, variants: [card]))
        #expect(model.presentedImage?.card == card)
        model.presentedImage = nil
        #expect(model.presentedDetail?.card == card)
    }

    @Test
    func `Opening the image directly does not open details`() {
        let model = TCGSearchScreenModel(preferences: nil)
        model.exploreImage(of: .init(card: card, variants: [card]))
        #expect(model.presentedImage?.directArtworkURL == card.imageURL)
        #expect(model.presentedDetail == nil)
    }

    @Test
    func `Missing artwork does not open exploration`() {
        let model = TCGSearchScreenModel(preferences: nil)
        let card = PricedCard(
            id: "no-image",
            game: .onePiece,
            name: "Nami",
            cardNumber: "OP01-016",
            illustrator: nil,
            pricedOn: .distantPast,
            fetchedAt: .distantPast
        )
        model.exploreImage(of: .init(card: card, variants: [card]))
        #expect(model.presentedImage == nil)
    }

    @Test
    func `Grouped presentation retains every variant and resolves only the selected artwork`() throws {
        let group = try #require(SearchVariantFixtures.groups(count: 5).first)
        let model = TCGSearchScreenModel(preferences: nil)
        model.showDetails(of: group)
        model.exploreImage(of: group)
        let image = try #require(model.presentedImage)
        let alternate = try #require(group.variants.last)
        #expect(image.variants.count == 5)
        #expect(image.directArtworkURL == nil)
        #expect(image.artworkURL(for: alternate.id) == alternate.imageURL)
        let alternateURL = try #require(alternate.imageURL)
        #expect(!image.collageURLs.contains(alternateURL))
        #expect(image.artworkURL(for: "unknown") == nil)
        model.presentedImage = nil
        #expect(model.presentedDetail?.variants == group.variants)
    }

    @Test
    func `Details keep the chosen variant and use its latest result for Add`() {
        let foil = SearchVariantFixtures.variant(0)
        let alternate = SearchVariantFixtures.variant(1)
        let refreshed = SearchVariantFixtures.variant(1, price: 250)
        var selection = SearchDetailVariantSelection()
        #expect(selection.selectedCard(defaultCard: foil, results: [foil, alternate]) == foil)
        selection.select(alternate)
        #expect(selection.selectedCard(defaultCard: foil, results: [foil]) == alternate)
        let selected = selection.selectedCard(defaultCard: foil, results: [foil, refreshed])
        #expect(selected.id == alternate.id)
        #expect(selected.imageURL == alternate.imageURL)
        #expect(selected.headline?.amount == 250)
    }

    private var card: PricedCard {
        PricedCard(
            id: "artwork",
            game: .pokemon,
            name: "Giratina",
            cardNumber: "186/196",
            illustrator: nil,
            imageURL: URL(string: "https://images.example.com/card.png")!,
            pricedOn: .distantPast,
            fetchedAt: .distantPast
        )
    }
}

enum SearchVariantFixtures {
    static func groups(count: Int) -> [SearchResultGroup] {
        SearchResultGroup.group((0..<count).map { variant($0) })
    }

    static func variant(_ index: Int, image: Int? = nil, hasArtwork: Bool = true, price: Double? = nil) -> PricedCard {
        PricedCard(
            id: "zoro-\(index)",
            game: .onePiece,
            name: "Roronoa Zoro",
            cardNumber: "OP01-025",
            rarity: "Super Rare",
            illustrator: index == 1 ? "Akira Egawa" : nil,
            variantName: index == 0 ? "foil" : "altArt \(index)",
            imageURL: hasArtwork ? URL(string: "https://images.example.com/zoro-\(image ?? index).png") : nil,
            headline: .init(amount: price ?? Double(5 + index * 25), currency: .usd),
            pricedOn: .distantPast,
            fetchedAt: .distantPast
        )
    }
}
