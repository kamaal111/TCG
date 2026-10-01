import Foundation
import TCGClient

enum TCGSearchHelpDocument {
    enum LoadError: Error, Equatable {
        case unavailable
    }

    static func load(game: ClientCardGame, bundle: Bundle = .module) -> Result<String, LoadError> {
        let name: String
        switch game {
        case .pokemon:
            name = "pokemon-search-help"
        case .onePiece:
            name = "one-piece-search-help"
        }

        guard let url = bundle.url(forResource: name, withExtension: "md") else {
            return .failure(.unavailable)
        }

        do {
            let markdown = try String(contentsOf: url, encoding: .utf8)
            guard !markdown.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                return .failure(.unavailable)
            }
            return .success(markdown)
        } catch {
            return .failure(.unavailable)
        }
    }
}
