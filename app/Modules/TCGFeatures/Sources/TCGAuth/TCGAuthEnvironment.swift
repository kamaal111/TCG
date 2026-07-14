//
//  TCGAuthEnvironment.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/12/26.
//

import KamaalUI
import SwiftUI

extension View {
    public func tcgAuth(_ auth: TCGAuth) -> some View {
        self.modifier(TCGAuthEnvironmentModifier(auth: auth))
    }
}

private struct TCGAuthEnvironmentModifier: ViewModifier {
    @State private var auth: TCGAuth

    init(auth: TCGAuth) {
        self.auth = auth
    }

    func body(content: Content) -> some View {
        KJustStack {
            if auth.initiallyValidatingToken {
                ProgressView()
            } else {
                if !auth.isLoggedIn {
                    NavigationStack {
                        TCGAuthSignInScreen()
                    }
                } else {
                    content
                }
            }
        }
        .environment(auth)
    }
}
