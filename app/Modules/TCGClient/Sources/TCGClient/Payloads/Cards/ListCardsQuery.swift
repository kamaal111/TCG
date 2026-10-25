import Foundation

public struct ListCardsQuery: Sendable {
    public let game: ClientCardGame?
    public let setNames: Set<String>
    public let cursor: String?
    public let collectionID: UUID?
    public let query: String?

    public init(game: ClientCardGame?, setNames: Set<String>, cursor: String?, collectionID: UUID?, query: String?) {
        self.game = game
        self.setNames = setNames
        self.cursor = cursor
        self.collectionID = collectionID
        self.query = query
    }
}
