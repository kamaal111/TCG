import SwiftUI
import TCGClient
import TCGDesignSystem

struct TCGBinderScreen: View {
    private static let zoomRange = 0.5...3.0

    @Environment(\.isEditingCollection) private var isEditingCollection
    @Environment(\.tcgCollections) private var collections
    @Environment(TCGCards.self) private var cards
    let collection: CardBinderCollection
    @State private var pageIndex = 0
    @State private var selection: BinderSlotSelection?
    @State private var isDeletingPage = false
    @State private var zoom = 1.0
    @State private var isAddingCard = false

    var body: some View {
        VStack(spacing: 12) {
            if !collection.pages.isEmpty {
                BinderSpreadView(
                    content: .init(collection: collection, zoom: zoom),
                    pageIndex: $pageIndex,
                    actions: .init(selectSlot: { selection = $0 }, deletePage: { isDeletingPage = true })
                )
            } else {
                ContentUnavailableView {
                    Label {
                        Text("No pages", bundle: .module)
                    } icon: {
                        Image(systemName: "rectangle.stack")
                    }
                } description: {
                    Text("Add an empty page to start arranging cards.", bundle: .module)
                }
            }
            TCGZoomSlider(value: $zoom, range: Self.zoomRange, label: Text("Zoom", bundle: .module))
            BinderPageActions(addPage: { Task { await addPage() } })

        }
        .padding()
        .navigationTitle(collection.isUnfiled ? String(localized: "Unfiled", bundle: .module) : collection.name)
        .toolbar {
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
        .onChange(of: collection.pages.count) { pageIndex = min(pageIndex, max(0, collection.pages.count - 1)) }
        .sheet(item: $selection) { selection in
            if let collections, isEditingCollection || selection.card == nil {
                NavigationStack {
                    BinderSlotEditor(collection: collection, position: selection.position, collections: collections)
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

    private func addPage() async {
        var updated = collection
        updated.pages.append(BinderPage(id: UUID(), slots: []))
        if await collections?.save(updated, using: cards) == true { pageIndex = updated.pages.count - 1 }
    }

    private func deleteCurrentPage() async {
        guard isEditingCollection else { return }
        guard let page = currentPage else { return }
        var updated = collection
        updated.pages.removeAll { $0.id == page.id }
        _ = await collections?.save(updated, using: cards)
    }

}
