//
//  TCGSearchEnvironment.swift
//  TCGFeatures
//

import SwiftUI

extension View {
    public func tcgSearch(_ search: TCGSearch) -> some View { environment(search) }
}
