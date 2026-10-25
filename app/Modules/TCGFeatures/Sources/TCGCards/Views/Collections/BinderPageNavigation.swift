import SwiftUI
import TCGClient

struct BinderPageNavigation: View {
    @Environment(\.isEditingCollection) private var isEditingCollection
    struct Content {
        let pages: [BinderPage]
        let capacity: Int
        let visibleRange: Range<Int>
    }

    let content: Content
    @Binding var index: Int
    let deletePage: () -> Void

    var body: some View {
        HStack {
            Button {
                index = max(0, content.visibleRange.lowerBound - content.capacity)
            } label: {
                Image(systemName: "chevron.left")
            }
            .disabled(content.visibleRange.lowerBound == 0)
            .accessibilityLabel(Text("Previous page", bundle: .module))
            .help(Text("Previous page", bundle: .module))
            Picker(selection: $index) {
                ForEach(Array(content.pages.enumerated()), id: \.element.id) { index, _ in
                    Text("Page \(index + 1)", bundle: .module).tag(index)
                }
            } label: {
                Text("Page", bundle: .module)
            }
            .labelsHidden()
            .help(Text("Page", bundle: .module))
            if content.visibleRange.count > 1 {
                Text("Pages \(content.visibleRange.lowerBound + 1)–\(content.visibleRange.upperBound)", bundle: .module)
                    .lineLimit(1)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Button {
                index = content.visibleRange.upperBound
            } label: {
                Image(systemName: "chevron.right")
            }
            .disabled(content.visibleRange.upperBound >= content.pages.count)
            .accessibilityLabel(
                Text("Next page", bundle: .module)
            )
            .help(Text("Next page", bundle: .module))
            if isEditingCollection {
                Button(role: .destructive) {
                    deletePage()
                } label: {
                    Image(systemName: "trash")
                }
                .accessibilityLabel(Text("Delete page \(index + 1)", bundle: .module))
                .help(Text("Delete page \(index + 1)", bundle: .module))
            }
        }
    }
}
