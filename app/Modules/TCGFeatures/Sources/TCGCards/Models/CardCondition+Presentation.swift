//
//  CardCondition+Presentation.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/20/26.
//

import Foundation
import TCGClient

extension CardCondition {
    var title: String {
        switch self {
        case .mint: String(localized: "Mint")
        case .nearMint: String(localized: "Near Mint")
        case .excellent: String(localized: "Excellent")
        case .good: String(localized: "Good")
        case .played: String(localized: "Played")
        case .damaged: String(localized: "Damaged")
        }
    }
}
