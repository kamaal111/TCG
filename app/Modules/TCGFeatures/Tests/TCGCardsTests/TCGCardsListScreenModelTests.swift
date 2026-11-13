import Foundation
import Testing

@testable import TCGCards
@testable import TCGClient

@Suite("TCGCards List Screen Model Tests")
@MainActor
struct TCGCardsListScreenModelTests {
    @Test
    func `Edit opens the saved card directly in the form`() {
        let model = TCGCardsListScreenModel(preferences: nil)
        let card = PreviewTCGCardsClient.sampleCards[1]
        let priced = CardWithPrice(card: card, price: PreviewTCGCardsClient.price(for: card))

        model.showEdit(for: priced)

        #expect(model.presentedForm?.id == .edit(card.id))
        let editor = TCGCardFormScreenModel(editing: priced)
        #expect(editor.values == CardFormValues(card: card))
    }

    @Test
    func `Adding then moving Pikachu preserves its purchases and excludes the current collection`() async throws {
        let context = await CollectionTestFixtures.loadedContext()
        let model = TCGCardsListScreenModel(preferences: nil)
        let pikachu = try #require(context.cards.cards.first { $0.card.name == "Pikachu" }).card
        let favorites = try await context.collections.create(name: "Favorites").get()
        let trades = try await context.collections.create(name: "Trades").get()
        #expect(pikachu.collectionID == nil)
        #expect(
            model.destinations(for: pikachu, in: context.collections.collections).map(\.id).contains(favorites.id)
        )

        await model.move(pikachu, to: favorites.summary, using: context.cards)

        let filed = try #require(context.cards.cards.first { $0.card.id == pikachu.id }).card
        #expect(filed.collectionID == favorites.id)
        let candidates = model.destinations(for: filed, in: context.collections.collections)
        #expect(candidates.contains { $0.id == trades.id })
        #expect(!candidates.contains { $0.isUnfiled || $0.id == favorites.id })
        await context.collections.select(favorites.id, using: context.cards)

        await model.move(filed, to: trades.summary, using: context.cards)

        #expect(!context.cards.cards.contains { $0.card.id == pikachu.id })
        await context.collections.select(trades.id, using: context.cards)
        let moved = try #require(context.cards.cards.first { $0.card.id == pikachu.id }).card
        #expect(moved.collectionID == trades.id)
        #expect(moved.purchases == pikachu.purchases)
        #expect(model.toast == nil)
    }

    @Test
    func `A failed move surfaces an error without changing the displayed membership`() async throws {
        let card = PreviewTCGCardsClient.sampleCards[1]
        let client = TCGClient.preview(
            cardsOutcome: .validationErrors([
                .init(code: "binder_full", path: ["collection_id"], message: "The binder is full.")
            ])
        )
        let cards = TCGCards(client: client)
        let model = TCGCardsListScreenModel(preferences: nil)
        let destination = CollectionTestFixtures.collection().summary
        await model.load(using: cards)
        let before = try #require(cards.cards.first { $0.card.id == card.id }).card

        await model.move(before, to: destination, using: cards)

        #expect(cards.cards.first { $0.card.id == card.id }?.card == before)
        #expect(model.toast?.message.contains("binder is full") == true)
    }

    @Test
    func `Restores illustrator filters and clears them when switching game`() async throws {
        let suiteName = "TCGCardsTests.\(UUID().uuidString)"
        let preferences = try #require(UserDefaults(suiteName: suiteName))
        defer { preferences.removePersistentDomain(forName: suiteName) }
        let model = TCGCardsListScreenModel(preferences: preferences)
        model.gameFilter = .pokemon
        model.illustrators = ["Mitsuhiro Arita"]
        let restored = TCGCardsListScreenModel(preferences: preferences)
        #expect(restored.illustrators == ["Mitsuhiro Arita"])
        let feature = TCGCards(client: .preview(cardsOutcome: .success(cards: PreviewTCGCardsClient.sampleCards)))
        await restored.load(using: feature)
        #expect(feature.cards.count == 1)
        #expect(feature.availableIllustrators == ["Mitsuhiro Arita"])
        restored.gameFilter = .onePiece
        #expect(restored.illustrators.isEmpty)
    }

    @Test
    func `Failed collection loads preserve saved selections`() async throws {
        let suiteName = "TCGCardsTests.\(UUID().uuidString)"
        let preferences = try #require(UserDefaults(suiteName: suiteName))
        defer { preferences.removePersistentDomain(forName: suiteName) }
        let model = TCGCardsListScreenModel(preferences: preferences)
        model.gameFilter = .pokemon
        model.setNames = ["Base Set"]
        let feature = TCGCards(client: .preview(cardsOutcome: .serverUnavailable))

        await model.load(using: feature)

        #expect(model.toast != nil)
        let restored = TCGCardsListScreenModel(preferences: preferences)
        #expect(restored.gameFilter == .pokemon)
        #expect(restored.setNames == ["Base Set"])
        model.dismissToast()
    }

    @Test
    func `Restores game and sets before the first collection load`() async throws {
        let suiteName = "TCGCardsTests.\(UUID().uuidString)"
        let preferences = try #require(UserDefaults(suiteName: suiteName))
        defer { preferences.removePersistentDomain(forName: suiteName) }
        let model = TCGCardsListScreenModel(preferences: preferences)
        model.gameFilter = .pokemon
        model.setNames = ["Base Set"]

        let restored = TCGCardsListScreenModel(preferences: preferences)
        #expect(restored.gameFilter == .pokemon)
        #expect(restored.setNames == ["Base Set"])
        let feature = TCGCards(client: .preview(cardsOutcome: .success(cards: PreviewTCGCardsClient.sampleCards)))
        await restored.resumeLoadIfNeeded(using: feature)
        #expect(feature.cards.map(\.card.id) == [CardsTestIDs.secondary])
    }

    @Test
    func `Restores multiple sets under all games and saves sorted names`() throws {
        let suiteName = "TCGCardsTests.\(UUID().uuidString)"
        let preferences = try #require(UserDefaults(suiteName: suiteName))
        defer { preferences.removePersistentDomain(forName: suiteName) }
        let model = TCGCardsListScreenModel(preferences: preferences)
        model.setNames = ["Romance Dawn", "Base Set"]

        let restored = TCGCardsListScreenModel(preferences: preferences)
        #expect(restored.gameFilter == nil)
        #expect(restored.setNames == ["Base Set", "Romance Dawn"])
        #expect(preferences.stringArray(forKey: "TCGCards.filters.setNames") == ["Base Set", "Romance Dawn"])
    }

    @Test
    func `Changing games persists cleared sets while the same game preserves them`() throws {
        let suiteName = "TCGCardsTests.\(UUID().uuidString)"
        let preferences = try #require(UserDefaults(suiteName: suiteName))
        defer { preferences.removePersistentDomain(forName: suiteName) }
        let model = TCGCardsListScreenModel(preferences: preferences)
        model.gameFilter = .pokemon
        model.setNames = ["Base Set"]
        model.gameFilter = .pokemon
        #expect(TCGCardsListScreenModel(preferences: preferences).setNames == ["Base Set"])

        model.gameFilter = .onePiece
        let restored = TCGCardsListScreenModel(preferences: preferences)
        #expect(restored.gameFilter == .onePiece)
        #expect(restored.setNames.isEmpty)

        model.setNames = ["Romance Dawn"]
        model.gameFilter = nil
        #expect(preferences.object(forKey: "TCGCards.filters.game") == nil)
        let allGames = TCGCardsListScreenModel(preferences: preferences)
        #expect(allGames.gameFilter == nil)
        #expect(allGames.setNames.isEmpty)
    }

    @Test
    func `Clearing sets preserves the saved game`() throws {
        let suiteName = "TCGCardsTests.\(UUID().uuidString)"
        let preferences = try #require(UserDefaults(suiteName: suiteName))
        defer { preferences.removePersistentDomain(forName: suiteName) }
        let model = TCGCardsListScreenModel(preferences: preferences)
        model.gameFilter = .pokemon
        model.setNames = ["Base Set"]
        model.setNames = []

        let restored = TCGCardsListScreenModel(preferences: preferences)
        #expect(restored.gameFilter == .pokemon)
        #expect(restored.setNames.isEmpty)
    }

    @Test
    func `Missing preferences use all games and all sets`() throws {
        let suiteName = "TCGCardsTests.\(UUID().uuidString)"
        let preferences = try #require(UserDefaults(suiteName: suiteName))
        defer { preferences.removePersistentDomain(forName: suiteName) }
        let model = TCGCardsListScreenModel(preferences: preferences)

        #expect(model.gameFilter == nil)
        #expect(model.setNames.isEmpty)
        #expect(preferences.object(forKey: "TCGCards.filters.setNames") == nil)
    }

    @Test(arguments: ["invalid", "42"])
    func `Invalid stored games reset both filters`(game: String) throws {
        let suiteName = "TCGCardsTests.\(UUID().uuidString)"
        let preferences = try #require(UserDefaults(suiteName: suiteName))
        defer { preferences.removePersistentDomain(forName: suiteName) }
        preferences.set(game, forKey: "TCGCards.filters.game")
        preferences.set(["Base Set"], forKey: "TCGCards.filters.setNames")
        let model = TCGCardsListScreenModel(preferences: preferences)

        #expect(model.gameFilter == nil)
        #expect(model.setNames.isEmpty)
    }

    @Test
    func `Malformed stored preferences fall back without losing a valid game`() throws {
        let suiteName = "TCGCardsTests.\(UUID().uuidString)"
        let preferences = try #require(UserDefaults(suiteName: suiteName))
        defer { preferences.removePersistentDomain(forName: suiteName) }
        preferences.set("pokemon", forKey: "TCGCards.filters.game")
        preferences.set(["Base Set", 42], forKey: "TCGCards.filters.setNames")
        let model = TCGCardsListScreenModel(preferences: preferences)
        #expect(model.gameFilter == .pokemon)
        #expect(model.setNames.isEmpty)

        preferences.set(42, forKey: "TCGCards.filters.game")
        preferences.set(["Base Set"], forKey: "TCGCards.filters.setNames")
        let malformedGame = TCGCardsListScreenModel(preferences: preferences)
        #expect(malformedGame.gameFilter == nil)
        #expect(malformedGame.setNames.isEmpty)
    }

    @Test
    func `Restored unavailable sets remain selectable after loading`() async throws {
        let suiteName = "TCGCardsTests.\(UUID().uuidString)"
        let preferences = try #require(UserDefaults(suiteName: suiteName))
        defer { preferences.removePersistentDomain(forName: suiteName) }
        let model = TCGCardsListScreenModel(preferences: preferences)
        model.gameFilter = .pokemon
        model.setNames = ["Crown Zenith"]
        let restored = TCGCardsListScreenModel(preferences: preferences)
        let feature = TCGCards(client: .preview(cardsOutcome: .success(cards: PreviewTCGCardsClient.sampleCards)))

        await restored.resumeLoadIfNeeded(using: feature)

        #expect(feature.cards.isEmpty)
        #expect(restored.setNames == ["Crown Zenith"])
        #expect(restored.availableSetNames(using: feature) == ["Base Set", "Crown Zenith"])
        #expect(TCGCardsListScreenModel(preferences: preferences).setNames == ["Crown Zenith"])
    }

    @Test
    func `Combines game and set selections without narrowing the choices`() async {
        let feature = TCGCards(client: .preview(cardsOutcome: .success(cards: PreviewTCGCardsClient.sampleCards)))
        let model = TCGCardsListScreenModel(preferences: nil)
        model.setNames = ["Base Set"]
        await model.load(using: feature)
        #expect(feature.cards.map(\.card.id) == [CardsTestIDs.secondary])
        #expect(model.availableSetNames(using: feature) == ["Base Set", "Romance Dawn"])

        model.setNames.insert("Romance Dawn")
        await model.load(using: feature)
        #expect(feature.cards.map(\.card) == PreviewTCGCardsClient.sampleCards)

        model.gameFilter = .pokemon
        #expect(model.setNames.isEmpty)
        model.setNames = ["Romance Dawn"]
        await model.load(using: feature)
        #expect(feature.cards.isEmpty)
        #expect(model.availableSetNames(using: feature) == ["Base Set", "Romance Dawn"])

        model.setNames = []
        await model.load(using: feature)
        #expect(feature.cards.map(\.card.id) == [CardsTestIDs.secondary])
    }

    @Test
    func `Filtered deletion removes the displayed card and retains its selection`() async throws {
        let feature = TCGCards(client: .preview(cardsOutcome: .success(cards: PreviewTCGCardsClient.sampleCards)))
        let model = TCGCardsListScreenModel(preferences: nil)
        model.setNames = ["Base Set"]
        await model.load(using: feature)

        await model.delete(at: IndexSet(integer: 0), using: feature)

        #expect(feature.cards.isEmpty)
        #expect(feature.availableSetNames == ["Romance Dawn"])
        #expect(model.setNames == ["Base Set"])
        #expect(model.availableSetNames(using: feature) == ["Base Set", "Romance Dawn"])
        model.setNames = []
        await model.load(using: feature)
        #expect(feature.cards.map(\.card.id) == [CardsTestIDs.primary])
    }

    @Test
    func `Multiple deletion offsets are captured before reloading the collection`() async {
        let feature = TCGCards(client: .preview(cardsOutcome: .success(cards: PreviewTCGCardsClient.sampleCards)))
        let model = TCGCardsListScreenModel(preferences: nil)
        await model.load(using: feature)

        await model.delete(at: IndexSet([0, 1]), using: feature)

        #expect(feature.cards.isEmpty)
        #expect(feature.availableSetNames.isEmpty)
    }

    @Test
    func `Adding outside the selected set refreshes choices without showing the new card`() async throws {
        let feature = TCGCards(client: .preview(cardsOutcome: .success(cards: PreviewTCGCardsClient.sampleCards)))
        let model = TCGCardsListScreenModel(preferences: nil)
        model.gameFilter = .pokemon
        model.setNames = ["Base Set"]
        await model.load(using: feature)
        var values = validValues
        values.game = .pokemon
        values.setName = "Crown Zenith"

        try await feature.addCard(values).get()

        #expect(feature.cards.map(\.card.id) == [CardsTestIDs.secondary])
        #expect(feature.availableSetNames == ["Base Set", "Crown Zenith"])
    }

    @Test
    func `Loads all games by default`() async {
        let feature = TCGCards(client: .preview(cardsOutcome: .success(cards: PreviewTCGCardsClient.sampleCards)))
        let model = TCGCardsListScreenModel(preferences: nil)

        await model.load(using: feature)

        #expect(model.gameFilter == nil)
        #expect(feature.cards.map(\.card) == PreviewTCGCardsClient.sampleCards)
    }

    @Test
    func `Switches games and restores the complete collection`() async {
        let feature = TCGCards(client: .preview(cardsOutcome: .success(cards: PreviewTCGCardsClient.sampleCards)))
        let model = TCGCardsListScreenModel(preferences: nil)

        model.gameFilter = .pokemon
        await model.load(using: feature)
        #expect(feature.cards.map(\.card.game) == [.pokemon])

        model.gameFilter = .onePiece
        await model.load(using: feature)
        #expect(feature.cards.map(\.card.game) == [.onePiece])

        model.gameFilter = nil
        await model.load(using: feature)
        #expect(feature.cards.map(\.card) == PreviewTCGCardsClient.sampleCards)
    }
}
