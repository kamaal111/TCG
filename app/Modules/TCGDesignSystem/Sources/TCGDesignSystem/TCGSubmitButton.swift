//
//  TCGSubmitButton.swift
//  TCGDesignSystem
//
//  Created by Kamaal M Farah on 7/20/26.
//

import SwiftUI

public struct TCGSubmitButton: View {
    private let title: String
    private let isLoading: Bool
    private let action: () -> Void

    public init(title: String, isLoading: Bool, action: @escaping () -> Void) {
        self.title = title
        self.isLoading = isLoading
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            HStack {
                if isLoading {
                    ProgressView()
                        .controlSize(.small)
                }
                Text(title)
                    .frame(maxWidth: .infinity)
            }
        }
        .buttonStyle(.borderedProminent)
        .controlSize(.large)
        .disabled(isLoading)
    }
}
