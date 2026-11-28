import Foundation
import Observation
import TCGClient
import TCGDesignSystem

@MainActor
@Observable
final class SetChecklistScreenModel {
    struct Request: Hashable {
        let filter: CatalogChecklistFilter
        let collectionRevision: Int
    }

    var filter: CatalogChecklistFilter = .all
    var selected: CatalogSetCard?
    private(set) var page = SetPageState<CatalogSetCard>()
    private(set) var summary: CatalogSetSummary?
    private var activeRequest: Request?
    private var loadedRequest: Request?
    private let destination: CatalogSetDestination

    init(destination: CatalogSetDestination) {
        self.destination = destination
    }

    func request(collectionRevision: Int) -> Request {
        .init(filter: filter, collectionRevision: collectionRevision)
    }

    func search(_ request: Request, using sets: TCGSets) async {
        guard loadedRequest != request else { return }
        await refresh(request, using: sets)
    }

    func nextScrollPage(for request: Request) -> TCGScrollPageID<UUID>? {
        guard loadedRequest == request, filter == request.filter else { return nil }
        return page.nextScrollPage
    }

    func refresh(_ request: Request, using sets: TCGSets) async {
        if request.filter != activeRequest?.filter { page = .init() }
        if activeRequest != request { loadedRequest = nil }
        activeRequest = request
        await load(request, cursor: nil, using: sets)
        guard !Task.isCancelled, activeRequest == request else { return }
        loadedRequest = request
    }

    func loadMore(for request: Request, using sets: TCGSets) async {
        guard activeRequest == request, page.canLoadMore, !page.isLoading else { return }
        await load(request, cursor: page.nextCursor, using: sets)
    }

    private func load(_ request: Request, cursor: String?, using sets: TCGSets) async {
        let id = page.begin()
        let result = await sets.checklist(for: destination, filter: request.filter, cursor: cursor)
        if page.finish(id, result: result.map(\.cards), replacing: cursor == nil),
            case .success(let data) = result
        {
            summary = data.set
        }
    }
}
