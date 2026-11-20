import Foundation
import Observation
import TCGClient

@MainActor
@Observable
public final class CardListFilterState {
    public enum PreferenceScope: String {
        case allCards = "TCGCards.filters"
        case wishlist = "TCGWishlist.filters"
    }

    public var game: CardGame? {
        didSet {
            guard game != oldValue else { return }
            setNames = []
            illustrators = []
            preferences?.set(game?.clientGame.rawValue, forKey: keys.game)
        }
    }
    public var setNames: Set<String> {
        didSet { preferences?.set(setNames.sorted(), forKey: keys.setNames) }
    }
    public var illustrators: Set<String> {
        didSet { preferences?.set(illustrators.sorted(), forKey: keys.illustrators) }
    }
    public var query = ""

    private let preferences: UserDefaults?
    private let keys: PreferenceKeys

    public init(preferences: UserDefaults?, preferenceScope: PreferenceScope) {
        let keys = PreferenceKeys(scope: preferenceScope)
        self.preferences = preferences
        self.keys = keys

        let storedGame = preferences?.object(forKey: keys.game)
        let savedGame = (storedGame as? String).flatMap(ClientCardGame.init(rawValue:))
        let canRestore = storedGame == nil || savedGame != nil
        game = savedGame.map(CardGame.init(client:))
        setNames = canRestore ? Set(preferences?.stringArray(forKey: keys.setNames) ?? []) : []
        illustrators =
            canRestore && savedGame != .onePiece
            ? Set(preferences?.stringArray(forKey: keys.illustrators) ?? [])
            : []
    }

    public var filters: CardListFilters {
        CardListFilters(game: game?.clientGame, setNames: setNames, illustrators: illustrators, query: query)
    }

    public func setChoices(_ available: Set<String>) -> [String] {
        available.union(setNames).sorted()
    }

    public func illustratorChoices(_ available: Set<String>) -> [String] {
        available.union(illustrators).sorted()
    }

    private struct PreferenceKeys {
        let scope: PreferenceScope

        var game: String { "\(scope.rawValue).game" }

        var setNames: String { "\(scope.rawValue).setNames" }

        var illustrators: String { "\(scope.rawValue).illustrators" }
    }
}
