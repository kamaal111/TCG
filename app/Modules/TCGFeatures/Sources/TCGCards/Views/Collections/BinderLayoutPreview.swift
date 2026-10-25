import SwiftUI
import TCGClient

struct BinderLayoutPreview: View {
    let originalPageCount: Int
    let preview: CardBinderCollection

    var body: some View {
        Section {
            Text("\(preview.columns) columns × \(preview.rows) rows", bundle: .module)
            Text("\(originalPageCount) pages → \(preview.pages.count) pages", bundle: .module)
            ForEach(Array(preview.pages.enumerated()), id: \.element.id) { index, page in
                VStack(alignment: .leading) {
                    Text("Page \(index + 1)", bundle: .module).font(.headline)
                    if page.slots.isEmpty { Text("Empty page", bundle: .module).foregroundStyle(.secondary) }
                    ForEach(Array(page.slots.enumerated()), id: \.offset) { _, slot in
                        Text("Row \(slot.row), column \(slot.column): ×\(slot.quantity)", bundle: .module)
                    }
                }
            }
        } header: {
            Text("Preview", bundle: .module)
        }
    }
}
