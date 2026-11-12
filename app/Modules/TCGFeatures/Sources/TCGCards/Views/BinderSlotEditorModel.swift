import Foundation
import Observation
import TCGClient

@MainActor
@Observable
final class BinderSlotEditorModel {
    enum Screen {
        case collectionCards
        case unfiledCards
        case contents
    }

    private(set) var collection: CardBinderCollection
    private let position: BinderPosition
    private(set) var screen: Screen = .collectionCards
    private var pages = CardCollectionPages()
    private var sourceCollectionID: UUID?
    private var requestRevision = 0
    private var requestedQuery: String?
    private(set) var query = ""
    private(set) var isLoadingNextPage = false
    private(set) var nextPageError: TCGCardsOperationError?

    var availableCards: [CardWithPrice] { pages.cards }
    var hasMoreCards: Bool { pages.nextCursor != nil }
    private var searchQuery: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }

    private(set) var selectedCard: CardWithPrice?
    private var moveFromUnfiledCardID: UUID?
    private(set) var isLoading = true
    private(set) var isSaving = false
    private(set) var needsReload = false
    private(set) var error: String?
    var quantity = 1

    init(collection: CardBinderCollection, position: BinderPosition, card: CardWithPrice? = nil) {
        self.collection = collection
        self.position = position
        screen = existing == nil ? .collectionCards : .contents
        quantity = existing?.quantity ?? 1
        selectedCard = card?.card.id == existing?.cardID ? card : nil
        isLoading = selectedCard == nil
    }

    var existing: BinderSlot? {
        collection.pages.first { $0.id == position.pageID }?.slots.first {
            $0.row == position.row && $0.column == position.column
        }
    }

    var maximum: Int {
        guard let selectedCard else { return 0 }
        let credit = existing?.cardID == selectedCard.card.id ? existing?.quantity ?? 0 : 0
        return max(0, selectedCard.card.totalQuantity - collection.allocatedCopies(of: selectedCard.card.id) + credit)
    }

    var canSave: Bool {
        selectedCard != nil && BinderSlotQuantity(maximum: maximum).permits(quantity)
            && !isLoading && !isSaving && !needsReload
    }

    func load(using cards: TCGCards, collections: TCGCollections) async {
        guard !cards.isReadOnly else { return }
        requestRevision += 1
        let revision = requestRevision
        isLoading = true
        isLoadingNextPage = false
        error = nil
        nextPageError = nil
        pages = CardCollectionPages()
        requestedQuery = searchQuery

        if screen == .contents {
            if selectedCard == nil, let existing {
                let result = await collections.page(position.pageID)
                guard revision == requestRevision else { return }
                switch result {
                case .success(let page): selectedCard = page.cards.first { $0.card.id == existing.cardID }
                case .failure(let failure): error = failure.localizedDescription
                }
                if selectedCard == nil { error = error ?? CollectionsError.notFound.localizedDescription }
            }
            isLoading = false
            return
        }

        let collectionID: UUID
        switch screen {
        case .unfiledCards:
            guard let unfiled = collections.unfiled else {
                isLoading = false
                error = CollectionsError.notFound.localizedDescription
                return
            }
            collectionID = unfiled.id
        case .collectionCards: collectionID = collection.id
        case .contents: return
        }
        sourceCollectionID = collectionID
        let result = await cards.cardPage(pageQuery(collectionID: collectionID, cursor: nil))
        guard revision == requestRevision else { return }
        guard !Task.isCancelled else { return }
        switch result {
        case .success(let page):
            if !pages.append(page) { error = TCGCardsOperationError.serverUnavailable.localizedDescription }
        case .failure(let failure): error = failure.localizedDescription
        }
        isLoading = false
    }

    func setQuery(_ value: String) {
        let previous = searchQuery
        query = value
        guard searchQuery != previous else { return }
        requestRevision += 1
        requestedQuery = nil
        pages = CardCollectionPages()
        isLoading = true
        isLoadingNextPage = false
        nextPageError = nil
        error = nil
    }

    func search(using cards: TCGCards, collections: TCGCollections) async {
        guard screen != .contents else { return }
        guard requestedQuery != searchQuery else { return }
        await load(using: cards, collections: collections)
    }

    func loadNextPage(retry: Bool = false, using cards: TCGCards) async {
        guard screen != .contents else { return }
        guard !isLoading, !isLoadingNextPage, !isSaving else { return }
        guard retry || nextPageError == nil else { return }
        guard let sourceCollectionID else { return }
        guard let cursor = pages.nextCursor else { return }
        let revision = requestRevision
        isLoadingNextPage = true
        nextPageError = nil
        let result = await cards.cardPage(pageQuery(collectionID: sourceCollectionID, cursor: cursor))
        guard revision == requestRevision else { return }
        guard !Task.isCancelled else { return }
        isLoadingNextPage = false
        switch result {
        case .success(let page):
            if !pages.append(page) { nextPageError = .serverUnavailable }
        case .failure(let failure): nextPageError = failure
        }
    }

    private func pageQuery(collectionID: UUID, cursor: String?) -> ListCardsQuery {
        .init(
            game: nil,
            setNames: [],
            cursor: cursor,
            collectionID: collectionID,
            query: searchQuery.isEmpty ? nil : searchQuery,
            illustrators: []
        )
    }

    func showCards(unfiled: Bool, using cards: TCGCards, collections: TCGCollections) async {
        guard !isSaving, !needsReload else { return }
        screen = unfiled ? .unfiledCards : .collectionCards
        query = ""
        requestedQuery = nil
        await load(using: cards, collections: collections)
    }

    func choose(_ card: CardWithPrice) {
        guard !isSaving, !needsReload else { return }
        requestRevision += 1
        isLoading = false
        isLoadingNextPage = false
        moveFromUnfiledCardID = screen == .unfiledCards ? card.card.id : nil
        selectedCard = card
        quantity = BinderSlotQuantity(maximum: maximum).clamped(quantity)
        screen = .contents
    }

    func reload(using cards: TCGCards, collections: TCGCollections) async {
        await collections.refresh(using: cards)
        guard let latest = collections.selected, latest.id == collection.id else {
            error = CollectionsError.notFound.localizedDescription
            return
        }
        guard latest.pages.contains(where: { $0.id == position.pageID }) else {
            error = CollectionsError.notFound.localizedDescription
            return
        }
        collection = latest
        selectedCard = nil
        query = ""
        requestedQuery = nil
        moveFromUnfiledCardID = nil
        quantity = existing?.quantity ?? 1
        screen = existing == nil ? .collectionCards : .contents
        needsReload = false
        await load(using: cards, collections: collections)
    }

    func save(clear: Bool = false, using cards: TCGCards, collections: TCGCollections) async -> Bool {
        guard !cards.isReadOnly, !isSaving, !collections.isWorking, !needsReload else { return false }
        guard clear ? existing != nil : canSave else { return false }
        guard cards.selectedCollection?.id == collection.id else { return false }
        guard let index = collection.pages.firstIndex(where: { $0.id == position.pageID }) else { return false }
        isSaving = true
        defer { isSaving = false }
        error = nil
        var updated = collection
        updated.pages[index].slots.removeAll { $0.row == position.row && $0.column == position.column }
        if !clear, let selectedCard {
            updated.pages[index].slots.append(
                .init(row: position.row, column: position.column, cardID: selectedCard.card.id, quantity: quantity)
            )
        }
        let payload = SaveBinderLayoutPayload(
            collection: updated,
            moveFromUnfiledCardID: clear ? nil : moveFromUnfiledCardID
        )
        if await collections.save(payload, using: cards) { return true }
        error = collections.error?.localizedDescription
        needsReload = collections.error == .conflict || collections.error == .notFound
        return false
    }
}
