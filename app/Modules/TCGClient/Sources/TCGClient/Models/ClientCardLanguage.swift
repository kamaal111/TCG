//
//  ClientCardLanguage.swift
//  TCGClient
//

/// A card language supported by pricing search, for example `.japanese`.
public enum ClientCardLanguage: String, Codable, Hashable, Sendable, CaseIterable {
    /// English cards (`en`), for example `ClientCardLanguage.english.rawValue`.
    case english = "en"
    /// Japanese cards (`ja`), for example `ClientCardLanguage.japanese.rawValue`.
    case japanese = "ja"

    /// Returns documented languages for a game, for example `supported(for: .pokemon)`.
    public static func supported(for game: ClientCardGame) -> [Self] {
        switch game {
        case .pokemon: [.english, .japanese]
        case .onePiece: [.english]
        }
    }

    /// Returns a sorted partial selection, or an empty array for unrestricted search.
    /// For example, `normalized([.english, .japanese], for: .pokemon)` returns `[]`.
    public static func normalized(_ selection: Set<Self>, for game: ClientCardGame) -> [Self] {
        guard selection != Set(supported(for: game)) else { return [] }
        return selection.sorted { $0.rawValue < $1.rawValue }
    }
}
