//
//  TCGFormField.swift
//  TCGDesignSystem
//
//  Created by Kamaal M Farah on 7/20/26.
//

import SwiftUI

public struct TCGFormField<Field: View>: View {
    private let label: LocalizedStringKey
    private let error: String?
    private let field: Field

    public init(label: LocalizedStringKey, error: String?, @ViewBuilder field: () -> Field) {
        self.label = label
        self.error = error
        self.field = field()
    }

    public var body: some View {
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
