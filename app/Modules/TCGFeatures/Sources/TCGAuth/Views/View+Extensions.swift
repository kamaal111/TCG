//
//  View+Extensions.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/14/26.
//

import SwiftUI

extension View {
    @ViewBuilder
    func authEmailInput() -> some View {
        #if os(iOS)
            textInputAutocapitalization(.never)
                .keyboardType(.emailAddress)
                .autocorrectionDisabled()
        #else
            autocorrectionDisabled()
        #endif
    }
}
