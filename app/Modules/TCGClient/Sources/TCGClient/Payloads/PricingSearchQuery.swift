import Foundation

public enum ClientCardSearchMode: String, Codable, Hashable, Sendable, CaseIterable {
    case card
    case illustrator
}

public struct PricingSearchQuery: Sendable {
    public let game: ClientCardGame
    public let query: String
    public let languages: Set<ClientCardLanguage>
    public let mode: ClientCardSearchMode
    public let cursor: String?

    public init(
        game: ClientCardGame,
        query: String,
        languages: Set<ClientCardLanguage>,
        mode: ClientCardSearchMode,
        cursor: String?
    ) {
        self.game = game
        self.query = query
        self.languages = languages
        self.mode = mode
        self.cursor = cursor
    }
}
