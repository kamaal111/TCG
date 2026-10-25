import SwiftUI
import TCGClient

struct BinderCardPicker: View {
    private enum Metrics {
        static let minimumWidth: CGFloat = 300
        static let minimumHeight: CGFloat = 400
        static let rowCornerRadius: CGFloat = 12
    }

    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    let cards: [CardWithPrice]
    @Binding var selection: UUID?

    private var filteredCards: [CardWithPrice] {
        let search = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !search.isEmpty else { return cards }
        return cards.filter { $0.card.matchesSearch(search) }
    }

    var body: some View {
        content(filteredCards)
    }

    private func content(_ visibleCards: [CardWithPrice]) -> some View {
        Group {
            #if os(macOS)
                ScrollView {
                    LazyVStack(spacing: 12) { cardRows(visibleCards) }
                        .padding()
                }
            #else
                List { cardRows(visibleCards) }
            #endif
        }
        .overlay {
            if visibleCards.isEmpty {
                ContentUnavailableView {
                    Label {
                        if cards.isEmpty {
                            Text("No cards", bundle: .module)
                        } else {
                            Text("No matching cards", bundle: .module)
                        }
                    } icon: {
                        Image(systemName: "rectangle.stack")
                    }
                }
            }
        }
        .searchable(text: $query, prompt: Text("Search cards", bundle: .module))
        .navigationTitle(Text("Choose a card", bundle: .module))
        .frame(minWidth: Metrics.minimumWidth, minHeight: Metrics.minimumHeight)
    }

    private func cardRows(_ cards: [CardWithPrice]) -> some View {
        ForEach(cards, id: \.card.id) { card in
            Button {
                selection = card.card.id
                dismiss()
            } label: {
                HStack {
                    BinderCardLabel(card: card)
                    Spacer()
                    if selection == card.card.id {
                        Image(systemName: "checkmark")
                            .foregroundStyle(.tint)
                            .accessibilityHidden(true)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            #if os(macOS)
                .padding()
                .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: Metrics.rowCornerRadius))
            #endif
            .accessibilityAddTraits(selection == card.card.id ? .isSelected : [])
            .help(Text("Choose \(card.card.name)", bundle: .module))
        }
    }
}
