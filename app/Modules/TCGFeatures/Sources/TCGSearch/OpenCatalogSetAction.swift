import SwiftUI
import TCGClient

@MainActor
public struct OpenCatalogSetAction {
    private let action: (ClientCardGame, CatalogSetReference) -> Void

    public init(_ action: @escaping (ClientCardGame, CatalogSetReference) -> Void) {
        self.action = action
    }

    func callAsFunction(_ game: ClientCardGame, _ set: CatalogSetReference) {
        action(game, set)
    }
}

extension EnvironmentValues {
    @Entry public var tcgOpenCatalogSet: OpenCatalogSetAction?
}
