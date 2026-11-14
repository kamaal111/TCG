import SwiftUI
import TCGDesignSystem

struct BinderDimensionFields: View {
    private static let squarePageShortcuts = [2, 3, 4]

    @Binding var columns: String
    @Binding var rows: String
    let selectPreset: (Int) -> Void

    var body: some View {
        TCGLabeledTextField(title: Text("Columns", bundle: .module), text: $columns)
        TCGLabeledTextField(title: Text("Rows", bundle: .module), text: $rows)
        #if os(iOS)
            presetButtons
        #else
            HStack {
                presetButtons
            }
        #endif
    }

    private var presetButtons: some View {
        ForEach(Self.squarePageShortcuts, id: \.self) { size in
            Button("\(size) × \(size)") { selectPreset(size) }
        }
    }
}
