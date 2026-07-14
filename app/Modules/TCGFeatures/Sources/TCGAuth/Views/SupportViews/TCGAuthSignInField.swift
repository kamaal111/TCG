//
//  TCGAuthSignInField.swift
//  TCGFeatures
//
//  Created by Kamaal M Farah on 7/14/26.
//

import SwiftUI

struct TCGAuthSignInField<Field: View>: View {
    private let label: LocalizedStringKey
    private let error: String?
    private let field: Field

    init(label: LocalizedStringKey, error: String?, @ViewBuilder field: () -> Field) {
        self.label = label
        self.error = error
        self.field = field()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.headline)
            field
                .textFieldStyle(.roundedBorder)
            if let error {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .accessibilityLabel("Error: \(error)")
            }
        }
    }
}
