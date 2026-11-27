import Foundation
import Observation
import TCGClient

@MainActor
@Observable
public final class TCGGameSelection {
    private static let preferenceKey = "TCGSearch.game"
    @ObservationIgnored private let preferences: UserDefaults?

    public var game: ClientCardGame {
        didSet { preferences?.set(game.rawValue, forKey: Self.preferenceKey) }
    }

    public init(preferences: UserDefaults?) {
        self.preferences = preferences
        game = preferences?.string(forKey: Self.preferenceKey).flatMap(ClientCardGame.init(rawValue:)) ?? .pokemon
    }
}
