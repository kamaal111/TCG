import KamaalUI
import SwiftUI
import TCGClient
import TCGCurrency

struct BinderSpreadView: View {
    struct Content {
        let collection: CardBinderCollection
        let canArrange: Bool
    }

    struct Actions {
        let selectSlot: (BinderSlotSelection) -> Void
        let deletePage: () -> Void
        let moveSlot: (BinderSlotDragPayload, BinderPosition) -> Bool
    }

    @Environment(TCGCards.self) private var cards
    @Environment(\.tcgPricePrivacy) private var pricePrivacy
    @Environment(\.tcgCollections) private var collections
    @Environment(\.tcgCurrency) private var currency
    @State private var interactionSession = BinderInteractionSession()
    @State private var viewport = CGSize.zero
    @State private var pageCards: [UUID: [CardWithPrice]] = [:]
    @State private var isPricing = false
    @State private var loadError: String?
    @State private var loadGeneration = UUID()
    @State private var handledRefreshID: UUID?
    @State private var previousIdentity: PageIdentity?
    @State private var verifiedPageIDs: Set<UUID> = []
    let content: Content
    @Binding var pageIndex: Int
    let actions: Actions

    private var layout: BinderSpreadLayout {
        .make(collection: content.collection, viewport: viewport)
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
                .collectionPriceStatus(
                    isVisible: isPricing && loadError == nil && pricePrivacy?.hidePrices != true,
                    bottomInset: 4
                )
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
                BinderPageLoadError(message: loadError, retry: { Task { await loadPages(force: true) } })
            }
        }
        .onChange(of: content.collection.id) { interactionSession.end() }
        .onDisappear { interactionSession.end() }
        .task(id: pageIdentity) {
            await updatePages(for: pageIdentity)
        }
    }

    private var pageIdentity: PageIdentity {
        PageIdentity(
            pages: visiblePages.map(\.id),
            revision: content.collection.revision,
            foreground: collections?.binderForegroundID,
            refresh: collections?.binderRefreshID,
            currency: currency?.displayIdentity
        )
    }

    private var pageRow: some View {
        HStack(spacing: BinderPageMetrics.spreadSpacing) {
            ForEach(visiblePages) { page in
                BinderPageView(
                    content: .init(
                        collection: content.collection,
                        page: page,
                        cards: (pageCards[page.id] ?? cachedRows(page.id)).filter {
                            !cards.deletedCardIDs.contains($0.card.id)
                        },
                        slotWidth: layout.slotWidth
                    ),
                    selectSlot: actions.selectSlot,
                    canArrange: content.canArrange,
                    interactionSession: interactionSession,
                    moveSlot: actions.moveSlot,
                    navigate: navigate
                )
                .frame(width: visiblePages.count > 1 ? layout.pageSize.width : nil)
            }
        }
        .ktakeSizeEagerly()
    }

    private func navigate(_ direction: BinderPageDirection) {
        guard interactionSession.payload == nil else { return }
        let range = layout.pageRange(startingAt: pageIndex, totalPages: content.collection.pages.count)
        if let index = BinderSpreadLayout.adjacentIndex(
            direction: direction,
            visibleRange: range,
            capacity: layout.capacity,
            totalPages: content.collection.pages.count
        ) {
            pageIndex = index
        }
    }

    private struct PageIdentity: Hashable {
        let pages: [UUID]
        let revision: Int
        let foreground: UUID?
        let refresh: UUID?
        let currency: TCGCurrency.DisplayIdentity?
    }

    private func updatePages(for identity: PageIdentity) async {
        guard !identity.pages.isEmpty else { return }

        let previous = previousIdentity
        previousIdentity = identity
        let force = handledRefreshID != nil && handledRefreshID != identity.refresh
        handledRefreshID = identity.refresh

        if !force, let previous, previous.pages == identity.pages, previous.revision == identity.revision,
            previous.foreground == identity.foreground, previous.currency != identity.currency,
            Set(identity.pages).isSubset(of: verifiedPageIDs)
        {
            let generation = UUID()
            loadGeneration = generation
            pageCards = pageCards.mapValues { $0.map(cards.compatibleDisplay) }
            await refreshPrices(ids: identity.pages, generation: generation, retry: false)
        } else {
            await loadPages(force: force)
        }
    }

    private func loadPages(force: Bool) async {
        let pages = visiblePages
        let ids = pages.map(\.id)
        let generation = UUID()
        loadGeneration = generation
        loadError = nil
        pageCards = Dictionary(uniqueKeysWithValues: ids.map { ($0, cachedRows($0)) })
        isPricing = false
        guard let collections else { return }
        verifiedPageIDs = Set(pages.filter { $0.slots.isEmpty }.map(\.id))
        for page in pages where !page.slots.isEmpty {
            guard !Task.isCancelled else { return }
            let result = await collections.page(page.id, using: cards, force: force)
            guard !Task.isCancelled else { return }
            guard generation == loadGeneration else { return }
            guard visiblePages.map(\.id) == ids else { return }
            switch result {
            case .success(let result):
                verifiedPageIDs.insert(page.id)
                let cached = Dictionary(grouping: pageCards[page.id] ?? [], by: \.card.id)
                let rows = result.cards.map { details in
                    cards.keepingPrice(for: details, cached: cached[details.card.id]?.first)
                }
                pageCards[page.id] = rows
            case .failure(let error):
                if error == .collectionNotFound {
                    await collections.collectionDisappeared(content.collection.id, using: cards)
                    return
                } else {
                    loadError = error.localizedDescription
                }
            }
        }

        await refreshPrices(ids: ids, generation: generation, retry: force)
    }

    private func refreshPrices(ids: [UUID], generation: UUID, retry: Bool) async {
        guard !cards.isReadOnly else { return }

        let rows = ids.flatMap { pageCards[$0] ?? [] }
        let preferred = currency?.displayIdentity.currency
        isPricing = cards.needsPriceRefresh(for: rows, currency: preferred, retry: retry)
        let refreshed = await cards.refreshedPrices(for: rows, currency: preferred, retry: retry)
        guard !Task.isCancelled, generation == loadGeneration, visiblePages.map(\.id) == ids,
            collections?.selectedID == content.collection.id
        else { return }

        let byID = Dictionary(grouping: refreshed, by: \.card.id)
        for id in ids {
            let rows = (pageCards[id] ?? []).compactMap { row -> CardWithPrice? in
                guard !cards.deletedCardIDs.contains(row.card.id) else { return nil }

                return byID[row.card.id]?.first ?? row
            }
            if pageCards[id] != rows {
                pageCards[id] = rows
                cards.snapshot.save(rows, for: scope(id))
            }
        }
        isPricing = false
    }

    private func scope(_ id: UUID) -> CollectionSnapshotCache.Scope {
        .init(collectionID: content.collection.id, pageID: id, revision: content.collection.revision)
    }

    private func cachedRows(_ id: UUID) -> [CardWithPrice] {
        let cardIDs = Set(content.collection.pages.first { $0.id == id }?.slots.map(\.cardID) ?? [])
        return cards.cachedBinderRows(for: scope(id), cardIDs: cardIDs)
    }
}
