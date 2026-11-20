import SwiftUI
import TCGClient
import TCGDesignSystem

struct CSVCardEditor: View {
    @Environment(\.dismiss) private var dismiss

    @State private var model: TCGCardFormScreenModel

    private let onSave: (CardFormValues) -> Void

    init(card: Card, onSave: @escaping (CardFormValues) -> Void) {
        _model = State(initialValue: .init(mode: .draft, initialValues: .init(card: card)))
        self.onSave = onSave
    }

    var body: some View {
        ScrollView {
            TCGCardFormFields(model: model) {
                if let values = model.saveDraft() {
                    onSave(values)
                    dismiss()
                }
            }
        }
        .tcgSheet(
            Text("Edit Import Card", bundle: .module),
            closeLabel: Text("Cancel", bundle: .module),
            closeDisabled: false,
            onClose: nil
        )
        #if os(macOS)
            .frame(width: 600, height: 650)
        #endif
    }
}
