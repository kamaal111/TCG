import SwiftUI
import TCGClient
import TCGCurrency

struct BinderSpreadView: View {
    struct Content {
        let collection: CardBinderCollection
        let zoom: Double
    }

    struct Actions {
        let selectSlot: (BinderSlotSelection) -> Void
        let deletePage: () -> Void
    }

    @Environment(\.tcgCollections) private var collections
    @Environment(\.tcgCurrency) private var currency
    @State private var viewport = CGSize.zero
    @State private var pageCards: [UUID: [CardWithPrice]] = [:]
    @State private var loadError: String?
    @State private var loadGeneration = UUID()
    let content: Content
    @Binding var pageIndex: Int
    let actions: Actions

    private var layout: BinderSpreadLayout {
        .make(collection: content.collection, viewport: viewport, zoom: content.zoom)
    }

    private var visiblePages: [BinderPage] {
        guard viewport.width > 0 else { return [] }
        guard viewport.height > 0 else { return [] }
        return Array(
            content.collection.pages[
                layout.pageRange(startingAt: pageIndex, totalPages: content.collection.pages.count)
            ]
        )
    }

    var body: some View {
        VStack(spacing: 12) {
            Color.clear
                .overlay(alignment: .top) { pageRow }
                .onGeometryChange(for: CGSize.self) {
                    $0.size
                } action: {
                    viewport = $0
                }
            BinderPageNavigation(
                content: .init(
                    pages: content.collection.pages,
                    capacity: layout.capacity,
                    visibleRange: layout.pageRange(startingAt: pageIndex, totalPages: content.collection.pages.count)
                ),
                index: $pageIndex,
                deletePage: actions.deletePage
            )
        }
        .overlay(alignment: .bottom) {
            if let loadError {
                BinderPageLoadError(message: loadError, retry: { Task { await loadPages() } })
            }
        }
        .task(
            id: PageIdentity(
                pages: visiblePages.map(\.id),
                revision: content.collection.revision,
                currency: currency?.displayIdentity
            )
        ) {
            await loadPages()
        }
    }

    private var pageRow: some View {
        HStack(spacing: BinderPageMetrics.spreadSpacing) {
            ForEach(visiblePages) { page in
                BinderPageView(
                    content: .init(
                        collection: content.collection,
                        page: page,
                        cards: pageCards[page.id] ?? [],
                        slotWidth: layout.slotWidth
                    ),
                    selectSlot: actions.selectSlot
                )
                .frame(width: visiblePages.count > 1 ? layout.pageSize.width : nil)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private struct PageIdentity: Hashable {
        let pages: [UUID]
        let revision: Int
        let currency: TCGCurrency.DisplayIdentity?
    }

    private func loadPages() async {
        let pages = visiblePages
        let ids = pages.map(\.id)
        let generation = UUID()
        loadGeneration = generation
        loadError = nil
        pageCards = [:]
        guard let collections else { return }
        for page in pages where !page.slots.isEmpty {
            guard !Task.isCancelled else { return }
            let result = await collections.page(page.id)
            guard !Task.isCancelled else { return }
            guard generation == loadGeneration else { return }
            guard visiblePages.map(\.id) == ids else { return }
            switch result {
            case .success(let result): pageCards[page.id] = result.cards
            case .failure(let error): loadError = error.localizedDescription
            }
        }
    }
}
