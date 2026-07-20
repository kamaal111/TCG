//
//  TCGApp.swift
//  TCGApp
//
//  Created by Kamaal M Farah on 6/28/26.
//

import SwiftUI
import TCGAuth
import TCGCards

public struct TCGScene: Scene {
    @State private var auth = TCGAuth.default()
    @State private var cards = TCGCards.default()

    public init() {}

    public var body: some Scene {
        WindowGroup {
            NavigationStack { TCGCardsListScreen() }
                .tcgCards(cards)
                .tcgAuth(auth)
        }
    }
}
