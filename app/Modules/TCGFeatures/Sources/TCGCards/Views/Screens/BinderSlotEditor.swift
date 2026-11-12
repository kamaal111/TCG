import SwiftUI
import TCGClient
import TCGDesignSystem

struct BinderSlotEditor: View {
    @Environment(TCGCards.self) private var cards
    @Environment(\.dismiss) private var dismiss
    let collections: TCGCollections
    @State private var model: BinderSlotEditorModel
    @State private var isShowingDetails = false

    struct Content {
        let collection: CardBinderCollection
        let position: BinderPosition
        var card: CardWithPrice?
    }

    init(content: Content, collections: TCGCollections) {
        self.init(
            model: BinderSlotEditorModel(
                collection: content.collection,
                position: content.position,
                card: content.card
            ),
            collections: collections
        )
    }

    init(model: BinderSlotEditorModel, collections: TCGCollections) {
        self.collections = collections
        _model = State(initialValue: model)
    }

    var body: some View {
        Group {
            switch model.screen {
            case .collectionCards, .unfiledCards:
                picker
            case .contents:
                if model.isLoading { ProgressView() } else { contents }
            }
        }
        .safeAreaInset(edge: .bottom) {
            if let error = model.error {
                VStack {
                    TCGInlineError(error)
                    Button {
                        Task {
                            if model.needsReload {
                                await model.reload(using: cards, collections: collections)
                            } else {
                                await model.load(using: cards, collections: collections)
                            }
                        }
                    } label: {
                        Text("Retry", bundle: .module)
                    }
                    .disabled(model.isSaving || model.isLoading)
                }
                .padding()
            }
        }
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button {
                    dismiss()
                } label: {
                    Text("Cancel", bundle: .module)
                }
                .disabled(model.isSaving)
            }
            if model.screen != .collectionCards {
                ToolbarItem(placement: backPlacement) {
                    Button {
                        Task { await model.showCards(unfiled: false, using: cards, collections: collections) }
                    } label: {
                        Text("Back", bundle: .module)
                    }
                    .disabled(model.isSaving || model.isLoading || model.needsReload)
                }
            }
            if model.screen == .contents {
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await save() }
                    } label: {
                        Text("Save", bundle: .module)
                    }
                    .disabled(!model.canSave || collections.isWorking)
                }
            }
        }
        .task {
            if model.isLoading { await model.load(using: cards, collections: collections) }
        }
        .sheet(isPresented: $isShowingDetails) {
            if let selectedCard = model.selectedCard {
                NavigationStack { TCGCardDetailScreen(model: .init(card: selectedCard)) }
            }
        }
        .interactiveDismissDisabled(model.isSaving)
        .frame(minWidth: 300, minHeight: 400)
    }

    private var backPlacement: ToolbarItemPlacement {
        #if os(iOS)
            .topBarLeading
        #else
            .navigation
        #endif
    }

    private var picker: some View {
        BinderCardPicker(
            content: .init(
                cards: model.availableCards,
                selection: model.selectedCard?.card.id,
                isUnfiled: model.screen == .unfiledCards,
                isLoading: model.isLoading,
                error: model.error,
                isLoadingNextPage: model.isLoadingNextPage,
                hasMore: model.hasMoreCards,
                nextPageError: model.nextPageError
            ),
            query: Binding(get: { model.query }, set: model.setQuery),
            actions: .init(
                choose: model.choose,
                addMore: model.screen == .collectionCards && !model.collection.isUnfiled
                    ? {
                        Task { await model.showCards(unfiled: true, using: cards, collections: collections) }
                    } : nil,
                loadNext: { Task { await model.loadNextPage(using: cards) } },
                retryNext: { Task { await model.loadNextPage(retry: true, using: cards) } },
                search: { await model.search(using: cards, collections: collections) }
            )
        )
    }

    private var contents: some View {
        Form {
            if let selectedCard = model.selectedCard {
                Button {
                    Task { await model.showCards(unfiled: false, using: cards, collections: collections) }
                } label: {
                    HStack {
                        BinderCardLabel(card: selectedCard)
                        Spacer()
                        Image(systemName: "chevron.right").foregroundStyle(.tertiary).accessibilityHidden(true)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(model.isSaving || model.needsReload)
                .help(Text("Choose a card", bundle: .module))
            }
            if model.maximum > 0 {
                Stepper(value: $model.quantity, in: 1...model.maximum) {
                    Text("Copies in this slot: \(model.quantity)", bundle: .module)
                }
                .disabled(model.isSaving)
                Text("\(model.maximum) copies available for this slot", bundle: .module).foregroundStyle(.secondary)
            } else {
                Text(
                    "No unplaced copies available. Clear another slot or add cards to this collection.",
                    bundle: .module
                )
            }
            if model.selectedCard != nil {
                Button {
                    isShowingDetails = true
                } label: {
                    Text("Card details", bundle: .module)
                }
            }
            if model.existing != nil {
                Button(role: .destructive) {
                    Task { await save(clear: true) }
                } label: {
                    Text("Clear slot", bundle: .module)
                }
                .disabled(model.isSaving || model.needsReload)
            }
        }
        .formStyle(.grouped)
        .navigationTitle(Text("Slot contents", bundle: .module))
    }

    private func save(clear: Bool = false) async {
        if await model.save(clear: clear, using: cards, collections: collections) { dismiss() }
    }
}
