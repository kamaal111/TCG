import SwiftUI
import TCGClient
import TCGModels

struct TCGSearchHistoryScreen: View {
    let history: TCGSearchHistoryStore
    let game: ClientCardGame
    let onSelect: (TCGSearchHistoryEntry) -> Void
    let onRemove: (TCGSearchHistoryEntry) -> Void
    let onClear: () -> Void

    @State private var isConfirmingClear = false

    var body: some View {
        content
            .navigationTitle(Text("Search history", bundle: .module))
            .confirmationDialog(
                Text("Clear search history?", bundle: .module),
                isPresented: $isConfirmingClear,
                titleVisibility: .visible
            ) {
                Button(role: .destructive, action: onClear) {
                    Text("Clear history", bundle: .module)
                }
                Button(role: .cancel) {
                } label: {
                    Text("Cancel", bundle: .module)
                }
            } message: {
                Text("This removes searches for the selected game from this device.", bundle: .module)
            }
    }

    @ViewBuilder
    private var content: some View {
        #if os(macOS)
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 16) {
                    if history.entries(for: game).isEmpty {
                        emptyHistory
                            .frame(maxWidth: .infinity, minHeight: 480)
                    } else {
                        historyHeader
                        historyRows
                    }
                }
                .padding(24)
            }
        #else
            List {
                if history.entries(for: game).isEmpty {
                    emptyHistory
                        .listRowSeparator(.hidden)
                } else {
                    Section {
                        historyRows
                    } header: {
                        historyHeader
                    }
                }
            }
        #endif
    }

    private var historyHeader: some View {
        HStack {
            Text(CardGame(client: game).title)
                .font(.headline)
            Spacer()
            Button {
                isConfirmingClear = true
            } label: {
                Text("Clear history", bundle: .module)
            }
            .buttonStyle(.borderless)
            .textCase(nil)
        }
    }

    private var historyRows: some View {
        TCGSearchHistoryRows(entries: history.entries(for: game), onSelect: onSelect, onRemove: onRemove)
    }

    private var emptyHistory: some View {
        ContentUnavailableView {
            Label {
                Text("No search history", bundle: .module)
            } icon: {
                Image(systemName: "clock")
            }
        } description: {
            Text("Searches that find cards will appear here.", bundle: .module)
        }
    }
}

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
