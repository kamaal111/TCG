import TCGClient

public struct CatalogSetDestination: Hashable, Sendable {
    let game: ClientCardGame
    let set: CatalogSetReference

    public init(game: ClientCardGame, set: CatalogSetReference) {
        self.game = game
        self.set = set
    }
}
