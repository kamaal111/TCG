import SwiftUI

struct CSVRowEditor: View {
    @Environment(\.dismiss) private var dismiss

    @State private var row: CSVImportRow

    private let onSave: (CSVImportRow) -> Void

    init(row: CSVImportRow, onSave: @escaping (CSVImportRow) -> Void) {
        var editable = row
        editable.isIncluded = true
        _row = State(initialValue: editable)
        self.onSave = onSave
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(
                        "Correct the values below. Card fields must match across purchases with the same card ID.",
                        bundle: .module
                    )
                }
                ForEach(CardsCSV.columns, id: \.self) { column in
                    VStack(alignment: .leading, spacing: 5) {
                        TextField(column.rawValue, text: Binding(get: { row[column] }, set: { row[column] = $0 }))
                        if column == .id {
                            Button {
                                row[.id] = UUID().uuidString.lowercased()
                            } label: {
                                Text("Generate Card ID", bundle: .module)
                            }
                        }
                        ForEach(CardsCSV.issues(for: row).filter { $0.column == column }) { issue in
                            Text(issue.explanation).font(.caption).foregroundStyle(.red)
                        }
                    }
                }
                Toggle(isOn: $row.isIncluded) { Text("Include this purchase", bundle: .module) }
            }.formStyle(.grouped)
                .navigationTitle(Text("Correct CSV Row", bundle: .module))
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button {
                            dismiss()
                        } label: {
                            Text("Cancel", bundle: .module)
                        }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button {
                            onSave(row)
                            dismiss()
                        } label: {
                            Text("Save Changes", bundle: .module)
                        }
                    }
                }
        }
        #if os(macOS)
            .frame(width: 550, height: 650)
        #endif
    }
}
