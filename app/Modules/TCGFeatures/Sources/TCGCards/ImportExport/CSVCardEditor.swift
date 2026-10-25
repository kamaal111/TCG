import SwiftUI
import TCGClient

struct CSVCardEditor: View {
    @Environment(\.dismiss) private var dismiss

    @State private var model: TCGCardFormScreenModel

    private let onSave: (CardFormValues) -> Void

    init(card: Card, onSave: @escaping (CardFormValues) -> Void) {
        _model = State(initialValue: .init(mode: .draft, initialValues: .init(card: card)))
        self.onSave = onSave
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                TCGCardFormFields(model: model) {
                    if let values = model.saveDraft() {
                        onSave(values)
                        dismiss()
                    }
                }
            }
            .navigationTitle(Text("Edit Import Card", bundle: .module))
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button {
                        dismiss()
                    } label: {
                        Text("Cancel", bundle: .module)
                    }
                }
            }
        }
        #if os(macOS)
            .frame(width: 600, height: 650)
        #endif
    }
}
