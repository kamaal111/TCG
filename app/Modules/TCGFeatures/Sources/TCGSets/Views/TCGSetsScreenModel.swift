import Foundation
import Observation
import TCGClient

@MainActor
@Observable
final class TCGSetsScreenModel {
    enum Section: String {
        case all, inProgress
    }

    struct Request: Hashable {
        let game: ClientCardGame
        let query: String
        let collectionRevision: Int
    }

    var query = ""
    private var pages: [Section: SetPageState<CatalogSetSummary>] = [:]
    private var activeRequest: Request?
    private var loadedRequest: Request?
    @ObservationIgnored private let debounce: Duration

    init(debounce: Duration) {
        self.debounce = debounce
    }

    func request(game: ClientCardGame, collectionRevision: Int) -> Request {
        .init(
            game: game,
            query: query.trimmingCharacters(in: .whitespacesAndNewlines),
            collectionRevision: collectionRevision
        )
    }

    func page(for section: Section) -> SetPageState<CatalogSetSummary> {
        pages[section] ?? .init()
    }

    func search(_ request: Request, using sets: TCGSets) async {
        guard loadedRequest != request else { return }
        await reload(request, using: sets, debounce: !request.query.isEmpty && activeRequest?.query != request.query)
    }

    func refresh(_ request: Request, using sets: TCGSets) async {
        await reload(request, using: sets, debounce: false)
    }

    func loadMore(_ section: Section, for request: Request, using sets: TCGSets) async {
        guard request == activeRequest else { return }
        let page = page(for: section)
        guard page.canLoadMore, !page.isLoading else { return }
        await load(section, request: request, cursor: page.nextCursor, using: sets)
    }

    private func reload(_ request: Request, using sets: TCGSets, debounce: Bool) async {
        if request.game != activeRequest?.game || request.query != activeRequest?.query {
            pages = [:]
        }
        if activeRequest != request { loadedRequest = nil }
        activeRequest = request
        if debounce { try? await Task.sleep(for: self.debounce) }
        guard !Task.isCancelled, activeRequest == request else { return }
        async let all: Void = load(.all, request: request, cursor: nil, using: sets)
        async let inProgress: Void = load(.inProgress, request: request, cursor: nil, using: sets)
        _ = await (all, inProgress)
        guard !Task.isCancelled, activeRequest == request else { return }
        loadedRequest = request
    }

    private func load(_ section: Section, request: Request, cursor: String?, using sets: TCGSets) async {
        let id = pages[section, default: .init()].begin()
        let result = await sets.list(
            game: request.game,
            query: request.query,
            inProgress: section == .inProgress,
            cursor: cursor
        )
        pages[section]?.finish(id, result: result, replacing: cursor == nil)
    }
}
