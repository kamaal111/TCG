import Foundation

public struct CardListFilters: Codable, Hashable, Sendable {
    public static let unfiltered = CardListFilters(game: nil, setNames: [], illustrators: [], query: nil)

    public let game: ClientCardGame?
    public let setNames: Set<String>
    public let illustrators: Set<String>
    public let query: String?

    public init(
        game: ClientCardGame?,
        setNames: Set<String>,
        illustrators: Set<String>,
        query: String?
    ) {
        self.game = game
        self.setNames = setNames
        self.illustrators = illustrators
        let trimmed = query?.trimmingCharacters(in: .whitespacesAndNewlines)
        self.query = trimmed == "" ? nil : trimmed
    }

    public var isActive: Bool {
        game != nil || !setNames.isEmpty || !illustrators.isEmpty || query != nil
    }

    var setNameParameters: [String]? { setNames.isEmpty ? nil : setNames.sorted() }

    var illustratorParameters: [String]? { illustrators.isEmpty ? nil : illustrators.sorted() }
}
