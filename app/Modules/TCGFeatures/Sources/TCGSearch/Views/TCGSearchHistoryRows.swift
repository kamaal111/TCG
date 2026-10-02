import SwiftUI

struct TCGSearchHistoryRows: View {
    let entries: [TCGSearchHistoryEntry]
    let onSelect: (TCGSearchHistoryEntry) -> Void
    let onRemove: (TCGSearchHistoryEntry) -> Void

    var body: some View {
        ForEach(entries) { entry in
            Button {
                onSelect(entry)
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: "clock")
                        .foregroundStyle(.secondary)
                        .accessibilityHidden(true)
                    Text(verbatim: entry.query)
                        .foregroundStyle(.primary)
                        .multilineTextAlignment(.leading)
                    Spacer(minLength: 0)
                }
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint(Text("Search again for current prices", bundle: .module))
            .accessibilityAction(named: Text("Remove from history", bundle: .module)) { onRemove(entry) }
            .contextMenu {
                Button(role: .destructive) {
                    onRemove(entry)
                } label: {
                    Label {
                        Text("Remove from history", bundle: .module)
                    } icon: {
                        Image(systemName: "trash")
                    }
                }
            }
            #if os(macOS)
                .overlay(alignment: .bottom) {
                    if entry.id != entries.last?.id {
                        Divider()
                    }
                }
            #else
                .swipeActions {
                    Button(role: .destructive) {
                        onRemove(entry)
                    } label: {
                        Label {
                            Text("Remove", bundle: .module)
                        } icon: {
                            Image(systemName: "trash")
                        }
                    }
                }
            #endif
        }
    }
}
