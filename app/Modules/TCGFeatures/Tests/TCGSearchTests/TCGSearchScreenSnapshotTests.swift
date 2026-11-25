//
//  TCGSearchScreenSnapshotTests.swift
//  TCGFeatures
//

import Foundation
import KamaalAuth
import SwiftUI
import TCGCurrency
import TCGDesignSystem
import TCGSnapshotTesting
import Testing

@testable import TCGClient
@testable import TCGSearch

#if os(iOS)
    import UIKit
#endif

@Suite("TCGSearch Screen Snapshot Tests", .serialized)
@MainActor
struct TCGSearchScreenSnapshotTests {
    @Test
    func `Renders the variant chooser before search details`() async throws {
        let group = try #require(SearchVariantFixtures.groups(count: 3).first)
        await assertScreenSnapshot(testName: #function, fileID: #fileID, file: #filePath, line: #line, column: #column)
        {
            SearchVariantDestination(group: group, purpose: .details) { card in
                Text(card.name)
            }
            .cardImageLoader(PreviewCardImageLoader(outcome: .success))
        }
    }

    @Test
    func `Renders a grouped One Piece result with four artwork tiles`() async throws {
        let group = try #require(SearchVariantFixtures.groups(count: 5).first)
        await assertScreenSnapshot(testName: #function, fileID: #fileID, file: #filePath, line: #line, column: #column)
        {
            VStack {
                PricedCardRow(group: group, actions: .init(add: {}, showDetails: {}, exploreImage: {}))
                Spacer()
            }
            .padding()
            .cardImageLoader(PreviewCardImageLoader(outcome: .success))
        }
    }

    @Test
    func `Renders the artwork chooser before zoom`() async throws {
        let group = try #require(SearchVariantFixtures.groups(count: 3).first)
        await assertScreenSnapshot(testName: #function, fileID: #fileID, file: #filePath, line: #line, column: #column)
        {
            SearchVariantPicker(variants: group.variants, purpose: .artwork, selectedID: group.card.id) { _ in }
                .cardImageLoader(PreviewCardImageLoader(outcome: .success))
        }
    }

    @Test
    func `Hides prices percentages and trends in search results`() async throws {
        let privacy = TCGPricePrivacy(defaults: nil)
        privacy.hidePrices = true
        let feature = TCGSearch(
            client: .preview(pricingOutcome: .success),
            history: TCGSearchHistoryStore(defaults: nil, now: Date.init)
        )
        let model = TCGSearchScreenModel(preferences: nil, debounce: ModuleConfig.searchDebounce)
        model.query = "Giratina"
        try await feature.search(.init(game: model.game, query: model.query, languages: [], mode: .card, cursor: nil))
            .get()
        #expect(!feature.results.isEmpty)
        await assertScreenSnapshot(testName: #function, fileID: #fileID, file: #filePath, line: #line, column: #column)
        {
            makeScreen(feature: feature, model: model).environment(\.tcgPricePrivacy, privacy)
        }
    }

    @Test
    func `Renders saved printings in the Wishlist list`() async {
        let model = await wishlistModel(entries: [detailCard, WishlistTestClient.luffy], query: "")
        await assertScreenSnapshot(testName: #function, fileID: #fileID, file: #filePath, line: #line, column: #column)
        {
            NavigationStack {
                TCGWishlistScreen(isVisible: false, model: model) { _, _ in EmptyView() }
            }
            .cardImageLoader(PreviewCardImageLoader(outcome: .success))
        }
    }

    @Test
    func `Hides prices in the Wishlist list`() async {
        let privacy = TCGPricePrivacy(defaults: nil)
        privacy.hidePrices = true
        let model = await wishlistModel(entries: [detailCard, WishlistTestClient.luffy], query: "")
        await assertScreenSnapshot(testName: #function, fileID: #fileID, file: #filePath, line: #line, column: #column)
        {
            NavigationStack {
                TCGWishlistScreen(isVisible: false, model: model) { _, _ in EmptyView() }
            }
            .environment(\.tcgPricePrivacy, privacy)
            .cardImageLoader(PreviewCardImageLoader(outcome: .success))
        }
    }

    @Test
    func `Renders the English name in saved Wishlist details`() async {
        let search = TCGSearch(
            client: .preview(hasValidCredentials: false),
            history: TCGSearchHistoryStore(defaults: nil, now: Date.init)
        )
        let date = Date(timeIntervalSince1970: 0)
        let card = PricedCard(
            id: "wishlist-shiftry",
            printingKey: nil,
            isWishlisted: true,
            game: .pokemon,
            name: "ダーテング",
            cardNumber: "072/071",
            setName: "Wild Force",
            rarity: nil,
            illustrator: "Mitsuhiro Arita",
            englishSearchAlias: "Shiftry",
            variantName: nil,
            imageURL: nil,
            headline: nil,
            market: nil,
            conditionPrices: nil,
            conditionValues: nil,
            display: nil,
            pricedOn: date,
            fetchedAt: date
        )
        #expect(search.results.isEmpty)
        await assertScreenSnapshot(testName: #function, fileID: #fileID, file: #filePath, line: #line, column: #column)
        {
            TCGSearchDetailView(
                card: card,
                variants: [],
                isWishlistEntry: true,
                onWishlistRemoval: nil,
                addForm: { _, _ in EmptyView() }
            )
            .tcgSearch(search)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(.background)
        }
    }

    @Test
    func `Renders Wishlist pricing without search results`() async {
        let search = TCGSearch(
            client: .preview(hasValidCredentials: false),
            history: TCGSearchHistoryStore(defaults: nil, now: Date.init)
        )
        #expect(search.results.isEmpty)
        await assertScreenSnapshot(testName: #function, fileID: #fileID, file: #filePath, line: #line, column: #column)
        {
            TCGSearchDetailView(
                card: detailCard,
                variants: [],
                isWishlistEntry: true,
                onWishlistRemoval: nil,
                addForm: { _, _ in EmptyView() }
            )
            .tcgSearch(search)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(.background)
            .environment(\.timeZone, TimeZone(secondsFromGMT: 0)!)
            .cardImageLoader(PreviewCardImageLoader(outcome: .success))
        }
    }

    @Test
    func `Renders no matching Wishlist printings`() async {
        let model = await wishlistModel(entries: [], query: "Pikachu")
        // Capture the results state independently of the system search field's clear button.
        await assertScreenSnapshot(testName: #function, fileID: #fileID, file: #filePath, line: #line, column: #column)
        {
            TCGWishlistScreen(isVisible: false, model: model) { _, _ in EmptyView() }
        }
    }

    private func wishlistModel(entries: [PricedCard], query: String) async -> TCGWishlistScreenModel {
        let wishlist = TCGWishlist(
            client: WishlistTestClient(
                responses: [
                    .success(.init(entries: entries, nextCursor: nil, availableSetNames: [], availableIllustrators: []))
                ],
                firstRequestGate: nil,
                saves: []
            ),
            accountID: nil
        )
        let model = TCGWishlistScreenModel(preferences: nil)
        model.filterState.query = query
        await model.refresh(using: wishlist, currency: nil)
        return model
    }

    #if os(iOS)
        @Test
        func `Shows a filled Wishlist heart to the left of Add`() async {
            await assertWishlistToolbar(saved: true, testName: #function)
        }

        @Test
        func `Shows an outlined Wishlist heart to the left of Add`() async {
            await assertWishlistToolbar(saved: false, testName: #function)
        }

        private func assertWishlistToolbar(saved: Bool, testName: String) async {
            let privacy = TCGPricePrivacy(defaults: nil)
            privacy.hidePrices = true
            let card = PricedCard(
                id: "550e8400-e29b-41d4-a716-446655440000",
                printingKey: String(repeating: "a", count: 64),
                isWishlisted: saved,
                game: .onePiece,
                name: "Monkey.D.Luffy",
                cardNumber: "OP05-119",
                setName: "Awakening of the New Era",
                rarity: nil,
                illustrator: nil,
                englishSearchAlias: nil,
                variantName: "Alternate Art",
                imageURL: nil,
                headline: nil,
                market: nil,
                conditionPrices: nil,
                conditionValues: nil,
                display: nil,
                pricedOn: Date(timeIntervalSince1970: 0),
                fetchedAt: Date(timeIntervalSince1970: 0)
            )
            await assertScreenSnapshot(
                testName: testName,
                fileID: #fileID,
                file: #filePath,
                line: #line,
                column: #column
            ) {
                TCGSearchDetailView(
                    card: card,
                    variants: [],
                    isWishlistEntry: false,
                    onWishlistRemoval: nil,
                    addForm: { _, _ in EmptyView() }
                )
                .tcgSearch(
                    TCGSearch(
                        client: .preview(hasValidCredentials: false),
                        history: TCGSearchHistoryStore(defaults: nil, now: Date.init)
                    )
                )
                .environment(
                    \.tcgWishlist,
                    TCGWishlist(
                        client: WishlistTestClient(responses: [], firstRequestGate: nil, saves: []),
                        accountID: nil
                    )
                )
                .environment(\.tcgPricePrivacy, privacy)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(.background)
            }
        }
    #endif

    @Test
    func `Hides financial sections in search details`() async {
        let privacy = TCGPricePrivacy(defaults: nil)
        privacy.hidePrices = true
        let card = catalogConditionCard(gradedPrices: gradedPrices)
        #expect(card.displayConditionValues?.contains { $0.basis == .interpolated } == true)
        #expect(card.displayGradedPrices.count == 2)
        await assertScreenSnapshot(testName: #function, fileID: #fileID, file: #filePath, line: #line, column: #column)
        {
            TCGSearchDetailView(
                card: card,
                variants: [],
                isWishlistEntry: false,
                onWishlistRemoval: nil,
                addForm: { _, _ in EmptyView() }
            )
            .tcgSearch(
                TCGSearch(
                    client: .preview(hasValidCredentials: false),
                    history: TCGSearchHistoryStore(defaults: nil, now: Date.init)
                )
            )
            .environment(\.tcgPricePrivacy, privacy)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(.background)
            .cardImageLoader(PreviewCardImageLoader(outcome: .success))
        }
    }

    @Test
    func `Hides conversion failures in search details`() async {
        let privacy = TCGPricePrivacy(defaults: nil)
        privacy.hidePrices = true
        let source = detailCard
        let card = PricedCard(
            id: source.id,
            printingKey: nil,
            isWishlisted: nil,
            game: source.game,
            name: source.name,
            cardNumber: source.cardNumber,
            setName: nil,
            rarity: nil,
            illustrator: source.illustrator,
            englishSearchAlias: source.englishSearchAlias,
            variantName: nil,
            imageURL: source.imageURL,
            headline: source.headline,
            market: source.market,
            conditionPrices: nil,
            conditionValues: nil,
            display: .init(
                preferredCurrency: .eur,
                headline: nil,
                market: nil,
                conditionPrices: nil,
                conditionValues: nil,
                conversionUnavailable: true
            ),
            pricedOn: source.pricedOn,
            fetchedAt: source.fetchedAt
        )
        #expect(card.conversionUnavailable)
        await assertScreenSnapshot(testName: #function, fileID: #fileID, file: #filePath, line: #line, column: #column)
        {
            TCGSearchDetailView(
                card: card,
                variants: [],
                isWishlistEntry: false,
                onWishlistRemoval: nil,
                addForm: { _, _ in EmptyView() }
            )
            .tcgSearch(
                TCGSearch(
                    client: .preview(hasValidCredentials: false),
                    history: TCGSearchHistoryStore(defaults: nil, now: Date.init)
                )
            )
            .environment(\.tcgPricePrivacy, privacy)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(.background)
            .cardImageLoader(PreviewCardImageLoader(outcome: .success))
        }
    }

    @Test
    func `Renders illustrator search results`() async {
        let feature = TCGSearch(
            client: .preview(pricingOutcome: .success),
            history: TCGSearchHistoryStore(defaults: nil, now: Date.init)
        )
        let model = TCGSearchScreenModel(preferences: nil, debounce: ModuleConfig.searchDebounce)
        model.mode = .illustrator
        model.query = "Akira Egawa"
        await model.performSearch(using: feature)
        #expect(feature.results.first?.illustrator == "Akira Egawa")
        await assertScreenSnapshot(testName: #function, fileID: #fileID, file: #filePath, line: #line, column: #column)
        { makeScreen(feature: feature, model: model) }
    }

    @Test
    func `Keeps pricing rows visible while refreshing`() async {
        let lightTransport = HistoryPricingTransport(suspended: true)
        let darkTransport = HistoryPricingTransport(suspended: true)
        let light = await makeRefreshingState(transport: lightTransport)
        let dark = await makeRefreshingState(transport: darkTransport)
        var states = [light, dark]

        await assertScreenSnapshot(testName: #function, fileID: #fileID, file: #filePath, line: #line, column: #column)
        {
            let state = states.removeFirst()
            #expect(state.feature.isSearching)
            #expect(state.feature.results.count == 1)
            return makeScreen(feature: state.feature, model: state.model)
        }

        await lightTransport.resume(count: 2)
        await darkTransport.resume(count: 2)
        await light.refresh.value
        await dark.refresh.value
    }

    private func makeRefreshingState(transport: HistoryPricingTransport) async -> (
        feature: TCGSearch, model: TCGSearchScreenModel, refresh: Task<Void, Never>
    ) {
        let feature = TCGSearch(
            client: .default(
                transport: transport,
                credentialsKeychainKey: "refresh-snapshot-credentials",
                credentialsStore: InMemoryCredentialsStore()
            ),
            history: TCGSearchHistoryStore(defaults: nil, now: Date.init)
        )
        let model = TCGSearchScreenModel(preferences: nil, debounce: ModuleConfig.searchDebounce)
        model.query = "Giratina"
        let initial = Task { await model.performSearch(using: feature) }
        await transport.waitUntilStarted(count: 1)
        await transport.resume(count: 1)
        await initial.value
        let refresh = Task { await model.performSearch(using: feature) }
        await transport.waitUntilStarted(count: 2)
        return (feature, model, refresh)
    }

    @Test
    func `Renders pricing results`() async throws {
        let feature = TCGSearch(
            client: .preview(pricingOutcome: .success),
            history: TCGSearchHistoryStore(defaults: nil, now: Date.init)
        )
        let model = TCGSearchScreenModel(preferences: nil, debounce: ModuleConfig.searchDebounce)
        model.query = "Giratina"
        model.game = .pokemon
        try await feature.search(.init(game: model.game, query: model.query, languages: [], mode: .card, cursor: nil))
            .get()

        #if os(iOS)
            let animationsWereEnabled = UIView.areAnimationsEnabled
        #endif

        await assertScreenSnapshot(testName: #function, fileID: #fileID, file: #filePath, line: #line, column: #column)
        { makeScreen(feature: feature, model: model) }

        #if os(iOS)
            #expect(UIView.areAnimationsEnabled == animationsWereEnabled)
        #endif
    }

    @Test
    func `Renders multiple selected search sets`() async {
        let state = await makeSetFilteredState(setNames: ["Crown Zenith", "Lost Origin"], nextOutcome: .matches)
        #expect(state.model.filteredResults(using: state.feature).count == 3)
        await assertScreenSnapshot(testName: #function, fileID: #fileID, file: #filePath, line: #line, column: #column)
        { makeScreen(feature: state.feature, model: state.model) }
    }

    @Test
    func `Renders no matching search sets after refresh`() async {
        let state = await makeSetFilteredState(setNames: ["Crown Zenith"], nextOutcome: .matches)
        await state.model.performSearch(using: state.feature)
        #expect(state.model.filteredResults(using: state.feature).isEmpty)
        #expect(state.feature.results.count == 1)
        await assertScreenSnapshot(testName: #function, fileID: #fileID, file: #filePath, line: #line, column: #column)
        { makeScreen(feature: state.feature, model: state.model) }
    }

    @Test
    func `Offers more results when the selected set is absent from the current page`() async {
        let state = await makeSetFilteredState(setNames: ["Crown Zenith"], nextOutcome: .firstPage)
        await state.model.performSearch(using: state.feature)
        #expect(state.model.filteredResults(using: state.feature).isEmpty)
        #expect(state.feature.nextCursor == "continue-search")
        await assertScreenSnapshot(testName: #function, fileID: #fileID, file: #filePath, line: #line, column: #column)
        { makeScreen(feature: state.feature, model: state.model) }
    }

    #if os(iOS)
        @Test
        func `Renders selected search sets with large text`() async {
            let state = await makeSetFilteredState(setNames: ["Crown Zenith", "Lost Origin"], nextOutcome: .matches)
            #expect(state.model.setNames.count == 2)
            await assertScreenSnapshot(
                testName: #function,
                fileID: #fileID,
                file: #filePath,
                line: #line,
                column: #column
            ) {
                makeScreen(feature: state.feature, model: state.model)
                    .environment(\.dynamicTypeSize, .accessibility3)
            }
        }
    #endif

    private func makeSetFilteredState(
        setNames: Set<String>,
        nextOutcome: HistoryPricingTransport.Outcome
    ) async -> (
        feature: TCGSearch, model: TCGSearchScreenModel
    ) {
        let transport = HistoryPricingTransport(suspended: false)
        await transport.setOutcome(.sets, for: 1)
        await transport.setOutcome(nextOutcome, for: 2)
        let feature = TCGSearch(
            client: .default(
                transport: transport,
                credentialsKeychainKey: "set-filter-snapshot-credentials",
                credentialsStore: InMemoryCredentialsStore()
            ),
            history: TCGSearchHistoryStore(defaults: nil, now: Date.init)
        )
        let model = TCGSearchScreenModel(preferences: nil, debounce: ModuleConfig.searchDebounce)
        model.query = "Giratina"
        await model.performSearch(using: feature)
        model.setNames = setNames
        return (feature, model)
    }

    @Test
    func `Renders an empty search`() async {
        let feature = TCGSearch(
            client: .preview(pricingOutcome: .empty),
            history: TCGSearchHistoryStore(defaults: nil, now: Date.init)
        )

        await assertScreenSnapshot(testName: #function, fileID: #fileID, file: #filePath, line: #line, column: #column)
        {
            makeScreen(
                feature: feature,
                model: TCGSearchScreenModel(preferences: nil, debounce: ModuleConfig.searchDebounce)
            )
        }
    }

    @Test
    func `Renders an empty One Piece search`() async {
        let feature = TCGSearch(
            client: .preview(pricingOutcome: .empty),
            history: TCGSearchHistoryStore(defaults: nil, now: Date.init)
        )
        let model = TCGSearchScreenModel(preferences: nil, debounce: ModuleConfig.searchDebounce)
        model.game = .onePiece

        await assertScreenSnapshot(testName: #function, fileID: #fileID, file: #filePath, line: #line, column: #column)
        { makeScreen(feature: feature, model: model) }
    }

    @Test
    func `Renders no results guidance`() async throws {
        let feature = TCGSearch(
            client: .preview(pricingOutcome: .noResults),
            history: TCGSearchHistoryStore(defaults: nil, now: Date.init)
        )
        let model = TCGSearchScreenModel(preferences: nil, debounce: ModuleConfig.searchDebounce)
        model.query = "Missing card"
        try await feature.search(.init(game: model.game, query: model.query, languages: [], mode: .card, cursor: nil))
            .get()

        await assertScreenSnapshot(testName: #function, fileID: #fileID, file: #filePath, line: #line, column: #column)
        { makeScreen(feature: feature, model: model) }
    }

    @Test
    func `Renders One Piece no results guidance`() async throws {
        let feature = TCGSearch(
            client: .preview(pricingOutcome: .noResults),
            history: TCGSearchHistoryStore(defaults: nil, now: Date.init)
        )
        let model = TCGSearchScreenModel(preferences: nil, debounce: ModuleConfig.searchDebounce)
        model.game = .onePiece
        model.query = "OP99-999"
        try await feature.search(.init(game: model.game, query: model.query, languages: [], mode: .card, cursor: nil))
            .get()

        await assertScreenSnapshot(testName: #function, fileID: #fileID, file: #filePath, line: #line, column: #column)
        { makeScreen(feature: feature, model: model) }
    }

    @Test
    func `Renders a Japanese language filter`() async {
        let feature = TCGSearch(
            client: .preview(pricingOutcome: .empty),
            history: TCGSearchHistoryStore(defaults: nil, now: Date.init)
        )
        let model = TCGSearchScreenModel(preferences: nil, debounce: ModuleConfig.searchDebounce)
        model.languages = [.japanese]

        #expect(model.languages == [.japanese])
        await assertScreenSnapshot(testName: #function, fileID: #fileID, file: #filePath, line: #line, column: #column)
        { makeScreen(feature: feature, model: model) }
    }

    @Test
    func `Explains Pokemon names and set numbers`() async {
        await assertScreenSnapshot(testName: #function, fileID: #fileID, file: #filePath, line: #line, column: #column)
        { makeHelp(game: .pokemon) }
    }

    @Test
    func `Explains One Piece names and card numbers`() async {
        await assertScreenSnapshot(testName: #function, fileID: #fileID, file: #filePath, line: #line, column: #column)
        { makeHelp(game: .onePiece) }
    }

    @Test
    func `Renders complete card details`() async {
        await assertScreenSnapshot(testName: #function, fileID: #fileID, file: #filePath, line: #line, column: #column)
        {
            TCGSearchDetailView(
                card: catalogConditionCard(gradedPrices: nil),
                variants: [],
                isWishlistEntry: false,
                onWishlistRemoval: nil,
                addForm: { _, _ in EmptyView() }
            )
            .tcgSearch(
                TCGSearch(
                    client: .preview(hasValidCredentials: false),
                    history: TCGSearchHistoryStore(defaults: nil, now: Date.init)
                )
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(.background)
            .environment(\.timeZone, TimeZone(secondsFromGMT: 0)!)
            .cardImageLoader(PreviewCardImageLoader(outcome: .success))
        }
    }

    @Test
    func `Renders card details without pricing or artwork`() async {
        let card = PricedCard(
            id: "missing-price",
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
            pricedOn: Date(timeIntervalSince1970: 1_750_000_000),
            fetchedAt: Date(timeIntervalSince1970: 1_750_000_000)
        )
        await assertScreenSnapshot(testName: #function, fileID: #fileID, file: #filePath, line: #line, column: #column)
        {
            TCGSearchDetailView(
                card: card,
                variants: [],
                isWishlistEntry: false,
                onWishlistRemoval: nil,
                addForm: { _, _ in EmptyView() }
            )
            .tcgSearch(
                TCGSearch(
                    client: .preview(hasValidCredentials: false),
                    history: TCGSearchHistoryStore(defaults: nil, now: Date.init)
                )
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(.background)
            .environment(\.timeZone, TimeZone(secondsFromGMT: 0)!)
        }
    }

    @Test
    func `Renders fitted image exploration`() async {
        await assertScreenSnapshot(testName: #function, fileID: #fileID, file: #filePath, line: #line, column: #column)
        {
            CardImageExplorer(url: detailCard.imageURL)
                .cardImageLoader(PreviewCardImageLoader(outcome: .success))
        }
    }

    @Test
    func `Renders failed image exploration with retry`() async {
        await assertScreenSnapshot(testName: #function, fileID: #fileID, file: #filePath, line: #line, column: #column)
        {
            CardImageExplorer(url: detailCard.imageURL)
                .cardImageLoader(PreviewCardImageLoader(outcome: .failure))
        }
    }

    @Test
    func `Renders image exploration while loading`() async {
        await assertScreenSnapshot(testName: #function, fileID: #fileID, file: #filePath, line: #line, column: #column)
        {
            CardImageExplorer(url: detailCard.imageURL)
                .cardImageLoader(SuspendedImageLoader())
        }
    }

    private var detailCard: PricedCard {
        PricedCard(
            id: "details",
            printingKey: nil,
            isWishlisted: nil,
            game: .pokemon,
            name: "Giratina V",
            cardNumber: "186/196",
            setName: nil,
            rarity: "Special Art Rare",
            illustrator: "Shinji Kanda",
            englishSearchAlias: nil,
            variantName: nil,
            imageURL: URL(string: "https://images.example.com/giratina.png")!,
            headline: PriceHeadline(amount: 420, currency: .usd, metric: .lowestNearMint),
            market: MarketPrice(
                condition: .nearMint,
                currency: .usd,
                low: 420,
                market: 450,
                trend7d: PriceMovement(priceChange: 12, percentChange: 2.7),
                trend30d: PriceMovement(priceChange: -20, percentChange: -4.3)
            ),
            conditionPrices: nil,
            conditionValues: nil,
            display: nil,
            pricedOn: Date(timeIntervalSince1970: 1_750_000_000),
            fetchedAt: Date(timeIntervalSince1970: 1_750_000_000)
        )
    }

    @Test
    func `Renders condition quotes in Wishlist details`() async {
        await assertScreenSnapshot(testName: #function, fileID: #fileID, file: #filePath, line: #line, column: #column)
        {
            TCGSearchDetailView(
                card: catalogConditionCard(gradedPrices: nil),
                variants: [],
                isWishlistEntry: true,
                onWishlistRemoval: nil,
                addForm: { _, _ in EmptyView() }
            )
            .tcgSearch(
                TCGSearch(
                    client: .preview(hasValidCredentials: false),
                    history: TCGSearchHistoryStore(defaults: nil, now: Date.init)
                )
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(.background)
            .environment(\.timeZone, TimeZone(secondsFromGMT: 0)!)
            .cardImageLoader(PreviewCardImageLoader(outcome: .success))
        }
    }

    @Test
    func `Renders graded-only search details`() async {
        await assertScreenSnapshot(testName: #function, fileID: #fileID, file: #filePath, line: #line, column: #column)
        {
            makeGradedDetail(isWishlistEntry: false)
        }
    }

    @Test
    func `Renders graded-only Wishlist details`() async {
        await assertScreenSnapshot(testName: #function, fileID: #fileID, file: #filePath, line: #line, column: #column)
        {
            makeGradedDetail(isWishlistEntry: true)
        }
    }

    private var gradedPrices: [GradedPrice] {
        [
            .init(company: "BGS", grade: 9.5, currency: .usd, low: nil, market: 90, population: nil),
            .init(company: "PSA", grade: 10, currency: .usd, low: 80, market: 100, population: 125),
        ]
    }

    private func makeGradedDetail(isWishlistEntry: Bool) -> some View {
        let pricedOn = Date(timeIntervalSince1970: 1_750_000_000)
        let card = PricedCard(
            id: "graded-only",
            printingKey: nil,
            isWishlisted: nil,
            game: .pokemon,
            name: "Giratina V",
            cardNumber: "186/196",
            setName: nil,
            rarity: nil,
            illustrator: nil,
            englishSearchAlias: nil,
            variantName: nil,
            imageURL: nil,
            headline: nil,
            market: nil,
            conditionPrices: [],
            conditionValues: [],
            gradedPrices: gradedPrices,
            display: nil,
            pricedOn: pricedOn,
            fetchedAt: pricedOn
        )
        return TCGSearchDetailView(
            card: card,
            variants: [],
            isWishlistEntry: isWishlistEntry,
            onWishlistRemoval: nil,
            addForm: { _, _ in EmptyView() }
        )
        .tcgSearch(
            TCGSearch(
                client: .preview(hasValidCredentials: false),
                history: TCGSearchHistoryStore(defaults: nil, now: Date.init)
            )
        )
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.background)
        .environment(\.timeZone, TimeZone(secondsFromGMT: 0)!)
    }

    private func catalogConditionCard(gradedPrices: [GradedPrice]?) -> PricedCard {
        PricedCard(
            id: "catalog-condition-prices",
            printingKey: nil,
            isWishlisted: nil,
            game: .pokemon,
            name: "Giratina V",
            cardNumber: "186/196",
            setName: nil,
            rarity: detailCard.rarity,
            illustrator: "Shinji Kanda",
            englishSearchAlias: nil,
            variantName: nil,
            imageURL: detailCard.imageURL,
            headline: nil,
            market: nil,
            conditionPrices: [
                MarketPrice(
                    condition: .nearMint,
                    currency: .usd,
                    low: 18,
                    market: 20,
                    trend7d: nil,
                    trend30d: nil
                ),
                MarketPrice(
                    condition: .excellent,
                    currency: .usd,
                    low: 0.02,
                    market: 0.02,
                    trend7d: nil,
                    trend30d: nil
                ),
                MarketPrice(
                    condition: .played,
                    currency: .usd,
                    low: nil,
                    market: 0.01,
                    trend7d: PriceMovement(priceChange: 0.002, percentChange: 25),
                    trend30d: nil
                ),
            ],
            conditionValues: [
                ConditionValue(
                    condition: .mint,
                    currency: .usd,
                    amount: 20 / 0.9,
                    basis: .adjusted,
                    conversionUnavailable: nil
                ),
                ConditionValue(
                    condition: .good,
                    currency: .usd,
                    amount: 0.015,
                    basis: .interpolated,
                    conversionUnavailable: nil
                ),
            ],
            gradedPrices: gradedPrices,
            display: nil,
            pricedOn: Date(timeIntervalSince1970: 1_750_000_000),
            fetchedAt: Date(timeIntervalSince1970: 1_750_000_000)
        )
    }

    @ViewBuilder
    private func makeHelp(game: ClientCardGame) -> some View {
        #if os(macOS)
            TCGSearchHelpView(game: game)
                .frame(width: 380)
        #else
            TCGSearchHelpView(game: game)
        #endif
    }

    @Test
    func `Renders recent searches`() async {
        let feature = makeHistoryFeature()
        #expect(feature.history.entries(for: .pokemon).count == 6)
        await assertScreenSnapshot(testName: #function, fileID: #fileID, file: #filePath, line: #line, column: #column)
        {
            makeScreen(
                feature: feature,
                model: TCGSearchScreenModel(preferences: nil, debounce: ModuleConfig.searchDebounce)
            )
        }
    }

    @Test
    func `Renders matching history suggestions`() async throws {
        let feature = makeHistoryFeature()
        let model = TCGSearchScreenModel(preferences: nil, debounce: ModuleConfig.searchDebounce)
        model.query = "Gira"
        model.isSearchFocused = true
        try await feature.search(.init(game: .pokemon, query: model.query, languages: [], mode: .card, cursor: nil))
            .get()
        #expect(feature.history.suggestions(for: model.query, game: model.game, mode: .card).count == 2)
        await assertScreenSnapshot(testName: #function, fileID: #fileID, file: #filePath, line: #line, column: #column)
        { makeScreen(feature: feature, model: model) }
    }

    @Test
    func `Renders full search history`() async {
        let feature = makeHistoryFeature()
        #expect(feature.history.entries(for: .pokemon).count == 6)
        await assertScreenSnapshot(testName: #function, fileID: #fileID, file: #filePath, line: #line, column: #column)
        { makeHistoryScreen(feature: feature) }
    }

    @Test
    func `Renders empty search history`() async {
        let feature = TCGSearch(
            client: .preview(pricingOutcome: .empty),
            history: TCGSearchHistoryStore(defaults: nil, now: Date.init)
        )
        #expect(feature.history.entries.isEmpty)
        await assertScreenSnapshot(testName: #function, fileID: #fileID, file: #filePath, line: #line, column: #column)
        { makeHistoryScreen(feature: feature) }
    }

    @Test
    func `Renders recent searches with large text`() async {
        let feature = makeHistoryFeature()
        #expect(feature.history.entries(for: .pokemon).count == 6)
        await assertScreenSnapshot(testName: #function, fileID: #fileID, file: #filePath, line: #line, column: #column)
        {
            makeScreen(
                feature: feature,
                model: TCGSearchScreenModel(preferences: nil, debounce: ModuleConfig.searchDebounce)
            )
            .environment(\.dynamicTypeSize, .accessibility3)
        }
    }

    private func makeHistoryFeature() -> TCGSearch {
        let history = TCGSearchHistoryStore(defaults: nil, now: { Date(timeIntervalSince1970: 1_753_267_800) })
        for query in ["sv5m 072/071", "Charizard ex 199", "Pikachu", "Giratina VSTAR GG69", "Giratina", "Eevee"] {
            history.record(query: query, game: .pokemon, mode: .card)
        }
        history.record(query: "Nami OP01-016", game: .onePiece, mode: .card)
        return TCGSearch(client: .preview(pricingOutcome: .success), history: history)
    }

    private func makeHistoryScreen(feature: TCGSearch) -> some View {
        NavigationStack {
            TCGSearchHistoryScreen(
                history: feature.history,
                game: .pokemon,
                onSelect: { _ in },
                onRemove: feature.history.remove,
                onClear: { feature.history.clear(game: .pokemon) }
            )
        }
    }

    private func makeScreen(feature: TCGSearch, model: TCGSearchScreenModel) -> some View {
        #if os(iOS)
            #expect(!UIView.areAnimationsEnabled)
        #endif

        return NavigationStack { TCGSearchScreen(model: model) { _, _ in EmptyView() } }
            .environment(feature)
            .cardImageLoader(PreviewCardImageLoader(outcome: .success))
    }
}

private struct SuspendedImageLoader: CardImageLoader {
    func cachedImage(for url: URL) -> Image? { nil }

    func image(for url: URL) async -> Image? {
        do {
            try await Task.sleep(for: .seconds(60))
        } catch {}
        return nil
    }
}
