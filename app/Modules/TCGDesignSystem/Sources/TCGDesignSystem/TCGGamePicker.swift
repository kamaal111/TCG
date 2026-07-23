//
//  TCGGamePicker.swift
//  TCGDesignSystem
//

import SwiftUI
import TCGModels

public struct TCGGamePicker: View {
    @Binding private var selection: CardGame?

    private let includesAllGames: Bool

    public init(selection: Binding<CardGame>) {
        _selection = Binding(selection)
        includesAllGames = false
    }

    public init(allGames selection: Binding<CardGame?>) {
        _selection = selection
        includesAllGames = true
    }

    public var body: some View {
        Picker("Game", selection: $selection) {
            if includesAllGames {
                Text("All games").tag(CardGame?.none)
            }
            ForEach(CardGame.allCases, id: \.self) { game in
                Text(game.title).tag(Optional(game))
            }
        }
        .pickerStyle(.segmented)
    }
}
