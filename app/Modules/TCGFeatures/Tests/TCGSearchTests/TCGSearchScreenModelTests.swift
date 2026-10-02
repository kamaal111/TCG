import Foundation
import Testing

@testable import TCGClient
@testable import TCGSearch

@Suite("TCGSearch Screen Model Tests")
@MainActor
struct TCGSearchScreenModelTests {
    @Test
    func `Restores separate raw language selections across launches and game changes`() throws {
        let suiteName = "TCGSearchTests.\(UUID().uuidString)"
        let preferences = try #require(UserDefaults(suiteName: suiteName))
        defer { preferences.removePersistentDomain(forName: suiteName) }
        let model = TCGSearchScreenModel(preferences: preferences)
        model.languages = [.english, .japanese]
        model.game = .onePiece
        #expect(model.languages.isEmpty)
        model.languages = [.english]
        model.game = .pokemon
        #expect(model.languages == [.english, .japanese])

        let restored = TCGSearchScreenModel(preferences: preferences)
        #expect(restored.languages == [.english, .japanese])
        restored.game = .onePiece
        #expect(restored.languages == [.english])
    }

    @Test(arguments: [["invalid"], ["ja", "invalid"]])
    func `Invalid stored selections default to all languages`(codes: [String]) throws {
        let suiteName = "TCGSearchTests.\(UUID().uuidString)"
        let preferences = try #require(UserDefaults(suiteName: suiteName))
        defer { preferences.removePersistentDomain(forName: suiteName) }
        preferences.set(codes, forKey: "TCGSearch.languages.pokemon")
        let model = TCGSearchScreenModel(preferences: preferences)

        #expect(model.languages.isEmpty)
    }

    @Test
    func `Unsupported stored One Piece languages default to all languages`() throws {
        let suiteName = "TCGSearchTests.\(UUID().uuidString)"
        let preferences = try #require(UserDefaults(suiteName: suiteName))
        defer { preferences.removePersistentDomain(forName: suiteName) }
        preferences.set(["ja"], forKey: "TCGSearch.languages.one_piece")
        let model = TCGSearchScreenModel(preferences: preferences)
        model.game = .onePiece

        #expect(model.languages.isEmpty)
    }

    @Test
    func `Submitting forwards the current language filter`() async {
        let feature = TCGSearch(client: .preview(pricingOutcome: .success))
        let model = TCGSearchScreenModel(preferences: nil)
        model.query = "Giratina"
        model.languages = [.japanese]
        await model.performSearch(using: feature)

        #expect(feature.hasSearched)
        #expect(feature.results.isEmpty)
        model.languages = [.english]
        await model.performSearch(using: feature)
        #expect(feature.results == [PreviewTCGPricingClient.samplePricedCards[1]])
    }

    @Test
    func `Short queries clear results even with a language filter`() async throws {
        let feature = TCGSearch(client: .preview(pricingOutcome: .success))
        try await feature.search(game: .pokemon, query: "Giratina").get()
        let model = TCGSearchScreenModel(preferences: nil)
        model.query = "x"
        model.languages = [.japanese]
        model.scheduleSearch(using: feature)

        #expect(!feature.hasSearched)
        #expect(feature.results.isEmpty)
    }
}
