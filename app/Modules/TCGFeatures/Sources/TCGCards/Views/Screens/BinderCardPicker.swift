import SwiftUI
import TCGClient

struct BinderCardPicker: View {
    private enum Metrics {
        static let minimumWidth: CGFloat = 300
        static let minimumHeight: CGFloat = 400
        static let rowCornerRadius: CGFloat = 12
    }

    struct Content {
        let cards: [CardWithPrice]
        let selection: UUID?
        var isUnfiled = false
        var isLoading = false
        var error: String?
        var isLoadingNextPage = false
        var hasMore = false
        var nextPageError: TCGCardsOperationError?
    }

    struct Actions {
        let choose: (CardWithPrice) -> Void
        var addMore: (() -> Void)?
        var loadNext: (() -> Void)?
        var retryNext: (() -> Void)?
        var search: (() async -> Void)?
    }

    struct EmptyMessage: View {
        let hasError: Bool
        let hasQuery: Bool

        var body: some View {
            ContentUnavailableView {
                Label {
                    if hasError {
                        Text("Couldn’t load cards", bundle: .module)
                    } else if hasQuery {
                        Text("No matching cards", bundle: .module)
                    } else {
                        Text("No cards", bundle: .module)
                    }
                } icon: {
                    Image(systemName: hasError ? "exclamationmark.triangle" : "rectangle.stack")
                }
            }
        }
    }

    let content: Content
    @Binding var query: String
    let actions: Actions

    private var cards: [CardWithPrice] { content.cards }
    private var selection: UUID? { content.selection }

    var body: some View {
        pickerContent
            .toolbar {
                if let addMore = actions.addMore {
                    ToolbarItem(placement: .primaryAction) {
                        Button(action: addMore) { Text("Add more", bundle: .module) }
                    }
                }
            }
            .task(id: query.trimmingCharacters(in: .whitespacesAndNewlines)) {
                guard let search = actions.search else { return }
                do { try await Task.sleep(for: .milliseconds(250)) } catch { return }
                await search()
            }
    }

    private var pickerContent: some View {
        Group {
            #if os(macOS)
                ScrollView {
                    LazyVStack(spacing: 12) {
                        cardRows
                        pagination
                    }
                    .padding()
                }
            #else
                List {
                    cardRows
                    pagination
                }
            #endif
        }
        .overlay {
            if cards.isEmpty {
                if content.isLoading {
                    ProgressView()
                } else {
                    EmptyMessage(
                        hasError: content.error != nil,
                        hasQuery: !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    )
                }
            }
        }
        .searchable(text: $query, prompt: Text("Search cards", bundle: .module))
        .navigationTitle(
            content.isUnfiled
                ? Text("Unfiled cards", bundle: .module) : Text("Choose a card", bundle: .module)
        )
        .frame(minWidth: Metrics.minimumWidth, minHeight: Metrics.minimumHeight)
    }

    @ViewBuilder
    private var pagination: some View {
        if content.isLoadingNextPage || content.nextPageError != nil {
            CollectionPaginationFooter(
                isLoading: content.isLoadingNextPage,
                error: content.nextPageError,
                retry: { actions.retryNext?() }
            )
        } else if content.hasMore {
            Button {
                actions.loadNext?()
            } label: {
                Text("Load more cards", bundle: .module)
            }
            .buttonStyle(.bordered)
            .padding()
        }
    }

    private var cardRows: some View {
        ForEach(cards, id: \.card.id) { card in
            Button {
                actions.choose(card)
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
            .onAppear {
                if content.hasMore && card.card.id == cards.last?.card.id { actions.loadNext?() }
            }
        }
    }
}
