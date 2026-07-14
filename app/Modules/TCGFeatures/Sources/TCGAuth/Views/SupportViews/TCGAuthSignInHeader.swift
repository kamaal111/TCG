//
//  TCGAuthSignInHeader.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/14/26.
//

import SwiftUI

struct TCGAuthSignInHeader: View {
    let mode: TCGAuthSignInScreenModel.Mode

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "person.crop.circle.badge.checkmark")
                .font(.system(size: 52))
                .foregroundStyle(.tint)
            Text("Welcome to TCG")
                .font(.largeTitle.bold())
            Text(mode == .login ? "Sign in to continue." : "Create an account to get started.")
                .foregroundStyle(.secondary)
        }
    }
}
