//
//  TCGCardsEnvironment.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/20/26.
//

import SwiftUI

extension View {
    public func tcgCards(_ cards: TCGCards) -> some View {
        environment(cards)
    }
}
