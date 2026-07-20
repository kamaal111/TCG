//
//  TCGCardsValidationIssue.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/20/26.
//

struct TCGCardsValidationIssue: Equatable, Sendable {
    let field: TCGCardsValidationField
    let message: String
}

enum TCGCardsValidationField: String, Hashable, Sendable {
    case name
    case setName = "set_name"
    case cardNumber = "card_number"
    case notes
    case quantities
}
