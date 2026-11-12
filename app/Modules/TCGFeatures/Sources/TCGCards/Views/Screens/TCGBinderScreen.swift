import SwiftUI
import TCGClient
import TCGDesignSystem

struct TCGBinderScreen: View {
    @Environment(\.isEditingCollection) private var isEditingCollection
    @Environment(\.tcgCollections) private var collections
    @Environment(TCGCards.self) private var cards
    let collection: CardBinderCollection
    @State private var pageIndex = 0
    @State private var selection: BinderSlotSelection?
    @State private var isDeletingPage = false
    @State private var isSavingLayout = false
    @State private var isAddingCard = false

    var body: some View {
        VStack(spacing: 12) {
            if !collection.pages.isEmpty {
                BinderSpreadView(
                    content: .init(collection: collection, canArrange: canArrange),
                    pageIndex: $pageIndex,
                    actions: .init(
                        selectSlot: { selection = $0 },
                        deletePage: { isDeletingPage = true },
                        moveSlot: moveSlot
                    )
                )
            } else {
                ContentUnavailableView {
                    Label {
                        Text("No pages", bundle: .module)
                    } icon: {
                        Image(systemName: "rectangle.stack")
                    }
                } description: {
                    if !cards.isReadOnly { Text("Add an empty page to start arranging cards.", bundle: .module) }
                }
            }
            if !cards.isReadOnly {
                BinderPageActions(
                    addPage: { Task { await addPage() } },
                    selectedPageNumber: currentPage == nil ? nil : pageIndex + 1,
                    insertPage: { Task { await insertPage() } }
                )
                .disabled(!canArrange)
            }

        }
        .padding()
        .navigationTitle(collection.isUnfiled ? String(localized: "Unfiled", bundle: .module) : collection.name)
        .toolbar {
            if !cards.isReadOnly {
                Button {
                    isAddingCard = true
                } label: {
                    Label {
                        Text("Add card", bundle: .module)
                    } icon: {
                        Image(systemName: "plus")
                    }
                }
                .help(Text("Add card", bundle: .module))
            }
        }
        .onChange(of: collection.pages.count) { pageIndex = min(pageIndex, max(0, collection.pages.count - 1)) }
        .sheet(item: $selection) { selection in
            if let collections, !cards.isReadOnly, isEditingCollection || selection.card == nil {
                NavigationStack {
                    BinderSlotEditor(
                        content: .init(collection: collection, position: selection.position, card: selection.card),
                        collections: collections
                    )
                }
                .environment(cards)
            } else if let card = selection.card {
                NavigationStack { TCGCardDetailScreen(model: .init(card: card)) }
            }
        }
        .sheet(isPresented: $isAddingCard) {
            NavigationStack { TCGCardFormScreen(model: .init(mode: .add, initialValues: nil)) }
        }
        .confirmationDialog(
            Text("Delete this page? Its cards will become unplaced.", bundle: .module),
            isPresented: $isDeletingPage,
            titleVisibility: .visible
        ) {
            Button(role: .destructive) {
                Task {
                    await deleteCurrentPage()
                }
            } label: {
                Text("Delete page", bundle: .module)
            }
        }
    }

    private var currentPage: BinderPage? {
        collection.pages.indices.contains(pageIndex) ? collection.pages[pageIndex] : nil
    }

    private var canArrange: Bool {
        !cards.isReadOnly && !isSavingLayout && collections?.isWorking != true
    }

    private var latestCollection: CardBinderCollection? {
        guard let selected = collections?.selected else { return nil }
        guard selected.id == collection.id else { return nil }
        return selected
    }

    private func addPage() async {
        guard canArrange else { return }
        guard var updated = latestCollection else { return }
        let pageID = UUID()
        updated.pages.append(BinderPage(id: pageID, slots: []))
        isSavingLayout = true
        await saveLayout(updated, selecting: pageID)
    }

    private func insertPage() async {
        guard canArrange else { return }
        guard let latest = latestCollection else { return }
        guard let page = currentPage else { return }
        let newPageID = UUID()
        guard let updated = BinderLayout.insertingEmptyPage(in: latest, before: page.id, pageID: newPageID) else {
            return
        }
        isSavingLayout = true
        await saveLayout(updated, selecting: newPageID)
    }

    private func moveSlot(_ payload: BinderSlotDragPayload, to destination: BinderPosition) -> Bool {
        guard canArrange else { return false }
        guard let latest = latestCollection else { return false }
        guard payload.matches(latest) else { return false }
        guard let updated = BinderLayout.movingSlot(in: latest, from: payload.source, to: destination) else {
            return false
        }
        isSavingLayout = true
        Task { await saveLayout(updated) }
        return true
    }

    private func saveLayout(_ updated: CardBinderCollection, selecting pageID: UUID? = nil) async {
        defer { isSavingLayout = false }
        guard await collections?.save(updated, using: cards) == true else { return }
        guard let saved = latestCollection else { return }
        if let pageID, let index = saved.pages.firstIndex(where: { $0.id == pageID }) {
            pageIndex = index
        }
    }

    private func deleteCurrentPage() async {
        guard isEditingCollection else { return }
        guard canArrange else { return }
        guard let page = currentPage else { return }
        guard var updated = latestCollection else { return }
        updated.pages.removeAll { $0.id == page.id }
        isSavingLayout = true
        await saveLayout(updated)
    }

}
