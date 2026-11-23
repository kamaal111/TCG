import Foundation
import SwiftUI
import Testing

@testable import TCGClient
@testable import TCGSearch

@Suite("Search Presentation Tests")
@MainActor
struct TCGSearchPresentationTests {
    @Test
    func `Opening details retains the selected card after clearing search`() async throws {
        let feature = TCGSearch(
            client: .preview(pricingOutcome: .success),
            history: TCGSearchHistoryStore(defaults: nil, now: Date.init)
        )
        try await feature.search(.init(game: .pokemon, query: "Giratina", languages: [], mode: .card, cursor: nil))
            .get()
        let card = try #require(feature.results.first)
        let model = TCGSearchScreenModel(preferences: nil, debounce: ModuleConfig.searchDebounce)
        model.showDetails(of: .init(card: card, variants: [card]))
        feature.clear()
        #expect(model.presentedDetail?.card == card)
        #expect(feature.results.isEmpty)
    }

    @Test
    func `Opening and closing the image preserves the selected detail`() {
        let model = TCGSearchScreenModel(preferences: nil, debounce: ModuleConfig.searchDebounce)
        model.showDetails(of: .init(card: card, variants: [card]))
        model.exploreImage(of: .init(card: card, variants: [card]))
        #expect(model.presentedImage?.card == card)
        model.presentedImage = nil
        #expect(model.presentedDetail?.card == card)
    }

    @Test
    func `Opening the image directly does not open details`() {
        let model = TCGSearchScreenModel(preferences: nil, debounce: ModuleConfig.searchDebounce)
        model.exploreImage(of: .init(card: card, variants: [card]))
        #expect(model.presentedImage?.directArtworkURL == card.imageURL)
        #expect(model.presentedDetail == nil)
    }

    @Test
    func `Missing artwork does not open exploration`() {
        let model = TCGSearchScreenModel(preferences: nil, debounce: ModuleConfig.searchDebounce)
        let card = PricedCard(
            id: "no-image",
            printingKey: nil,
            isWishlisted: nil,
            game: .onePiece,
            name: "Nami",
            cardNumber: "OP01-016",
            setName: nil,
            rarity: nil,
            illustrator: nil,
            englishSearchAlias: nil,
            variantName: nil,
            imageURL: nil,
            headline: nil,
            market: nil,
            conditionPrices: nil,
            conditionValues: nil,
            display: nil,
            pricedOn: .distantPast,
            fetchedAt: .distantPast
        )
        model.exploreImage(of: .init(card: card, variants: [card]))
        #expect(model.presentedImage == nil)
    }

    @Test
    func `Grouped presentation retains every variant and resolves only the selected artwork`() throws {
        let group = try #require(SearchVariantFixtures.groups(count: 5).first)
        let model = TCGSearchScreenModel(preferences: nil, debounce: ModuleConfig.searchDebounce)
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
    func `Details hide the alternative artwork picker when the selected variant has an image`() {
        let foil = SearchVariantFixtures.variant(0, image: nil, hasArtwork: true, price: nil)
        let alternate = SearchVariantFixtures.variant(1, image: nil, hasArtwork: true, price: nil)
        let group = SearchResultGroup(card: alternate, variants: [foil, alternate])

        #expect(!group.canExploreAlternativeArtwork)
    }

    @Test
    func `Details offer the artwork picker only when another variant has artwork`() {
        let foil = SearchVariantFixtures.variant(0, image: nil, hasArtwork: true, price: nil)
        let alternate = SearchVariantFixtures.variant(1, image: nil, hasArtwork: false, price: nil)
        let other = SearchVariantFixtures.variant(2, image: nil, hasArtwork: false, price: nil)

        #expect(SearchResultGroup(card: alternate, variants: [foil, alternate]).canExploreAlternativeArtwork)
        #expect(!SearchResultGroup(card: alternate, variants: [alternate, other]).canExploreAlternativeArtwork)
        #expect(!SearchResultGroup(card: alternate, variants: [alternate]).canExploreAlternativeArtwork)
    }

    @Test
    func `Details keep the chosen variant and use its latest result for Add`() {
        let foil = SearchVariantFixtures.variant(0, image: nil, hasArtwork: true, price: nil)
        let alternate = SearchVariantFixtures.variant(1, image: nil, hasArtwork: true, price: nil)
        let refreshed = SearchVariantFixtures.variant(1, image: nil, hasArtwork: true, price: 250)
        let group = SearchResultGroup(card: foil, variants: [foil, alternate])
        #expect(group.destinationCard(selected: nil) == nil)
        #expect(SearchResultGroup(card: foil, variants: [foil]).destinationCard(selected: nil) == foil)
        let choice = group.destinationCard(selected: alternate)
        #expect(choice == alternate)
        #expect(TCGSearchDetailView<EmptyView>.latestCard(for: alternate, in: [foil]) == alternate)
        let selected = TCGSearchDetailView<EmptyView>.latestCard(for: alternate, in: [foil, refreshed])
        #expect(selected.id == alternate.id)
        #expect(selected.imageURL == alternate.imageURL)
        #expect(selected.headline?.amount == 250)
    }

    @Test
    func `Details reuse the exact printing from a new day of search results`() {
        let key = String(repeating: "a", count: 64)
        let yesterday = pricedCard(id: "yesterday", key: key, isWishlisted: nil)
        let today = pricedCard(id: "today", key: key, isWishlisted: nil)
        let otherArtwork = pricedCard(id: "regular", key: String(repeating: "b", count: 64), isWishlisted: nil)
        #expect(TCGSearchDetailView<EmptyView>.latestCard(for: yesterday, in: [otherArtwork]) == yesterday)
        #expect(TCGSearchDetailView<EmptyView>.latestCard(for: yesterday, in: [otherArtwork, today]) == today)
    }

    @Test(arguments: [true, false])
    func `Acquisition uses the membership returned with the search card`(saved: Bool) {
        let key = String(repeating: "a", count: 64)
        let card = pricedCard(id: "selected", key: key, isWishlisted: saved)
        let model = WishlistDetailModel(isWishlistEntry: false)
        #expect(model.prepareAcquisition(for: card) == saved)
        #expect((model.acquiredPrintingKey == key) == saved)
    }

    @Test
    func `Acquisition from Wishlist already knows the card is saved`() {
        let key = String(repeating: "a", count: 64)
        let card = pricedCard(id: "selected", key: key, isWishlisted: nil)
        let model = WishlistDetailModel(isWishlistEntry: true)
        #expect(model.prepareAcquisition(for: card))
        #expect(model.acquiredPrintingKey == key)
    }

    private func pricedCard(id: String, key: String, isWishlisted: Bool?) -> PricedCard {
        PricedCard(
            id: id,
            printingKey: key,
            isWishlisted: isWishlisted,
            game: .onePiece,
            name: "Monkey.D.Luffy",
            cardNumber: "OP05-119",
            setName: nil,
            rarity: nil,
            illustrator: nil,
            englishSearchAlias: nil,
            variantName: nil,
            imageURL: nil,
            headline: nil,
            market: nil,
            conditionPrices: nil,
            conditionValues: nil,
            display: nil,
            pricedOn: .distantPast,
            fetchedAt: .distantPast
        )
    }

    private var card: PricedCard {
        PricedCard(
            id: "artwork",
            printingKey: nil,
            isWishlisted: nil,
            game: .pokemon,
            name: "Giratina",
            cardNumber: "186/196",
            setName: nil,
            rarity: nil,
            illustrator: nil,
            englishSearchAlias: nil,
            variantName: nil,
            imageURL: URL(string: "https://images.example.com/card.png")!,
            headline: nil,
            market: nil,
            conditionPrices: nil,
            conditionValues: nil,
            display: nil,
            pricedOn: .distantPast,
            fetchedAt: .distantPast
        )
    }
}

enum SearchVariantFixtures {
    static func groups(count: Int) -> [SearchResultGroup] {
        SearchResultGroup.group((0..<count).map { variant($0, image: nil, hasArtwork: true, price: nil) })
    }

    static func variant(_ index: Int, image: Int?, hasArtwork: Bool, price: Double?) -> PricedCard {
        PricedCard(
            id: "zoro-\(index)",
            printingKey: nil,
            isWishlisted: nil,
            game: .onePiece,
            name: "Roronoa Zoro",
            cardNumber: "OP01-025",
            setName: nil,
            rarity: "Super Rare",
            illustrator: index == 1 ? "Akira Egawa" : nil,
            englishSearchAlias: nil,
            variantName: index == 0 ? "foil" : "altArt \(index)",
            imageURL: hasArtwork ? URL(string: "https://images.example.com/zoro-\(image ?? index).png") : nil,
            headline: .init(amount: price ?? Double(5 + index * 25), currency: .usd, metric: .lowestNearMint),
            market: nil,
            conditionPrices: nil,
            conditionValues: nil,
            display: nil,
            pricedOn: .distantPast,
            fetchedAt: .distantPast
        )
    }
}
