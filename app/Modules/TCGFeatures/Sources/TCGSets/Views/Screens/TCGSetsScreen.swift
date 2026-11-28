import SwiftUI
import TCGClient
import TCGDesignSystem
import TCGListSupport
import TCGModels

public struct TCGSetsScreen<AddForm: View>: View {
    @Environment(TCGSets.self) private var sets
    @Binding private var path: [CatalogSetDestination]
    @Bindable private var gameSelection: TCGGameSelection
    @State private var model: TCGSetsScreenModel

    private let isVisible: Bool
    private let collectionRevision: Int
    private let onWishlistMembershipChange: (String, Bool) -> Void
    private let addForm: (PricedCard, @escaping () -> Void) -> AddForm

    public init(
        gameSelection: TCGGameSelection,
        path: Binding<[CatalogSetDestination]>,
        isVisible: Bool,
        collectionRevision: Int,
        onWishlistMembershipChange: @escaping (String, Bool) -> Void,
        @ViewBuilder addForm: @escaping (PricedCard, @escaping () -> Void) -> AddForm
    ) {
        self.init(
            gameSelection: gameSelection,
            path: path,
            isVisible: isVisible,
            collectionRevision: collectionRevision,
            model: TCGSetsScreenModel(debounce: CardQueryConfiguration.queryDebounce),
            onWishlistMembershipChange: onWishlistMembershipChange,
            addForm: addForm
        )
    }

    init(
        gameSelection: TCGGameSelection,
        path: Binding<[CatalogSetDestination]>,
        isVisible: Bool,
        collectionRevision: Int,
        model: TCGSetsScreenModel,
        onWishlistMembershipChange: @escaping (String, Bool) -> Void,
        @ViewBuilder addForm: @escaping (PricedCard, @escaping () -> Void) -> AddForm
    ) {
        _model = State(initialValue: model)
        self.gameSelection = gameSelection
        _path = path
        self.isVisible = isVisible
        self.collectionRevision = collectionRevision
        self.onWishlistMembershipChange = onWishlistMembershipChange
        self.addForm = addForm
    }

    public var body: some View {
        NavigationStack(path: $path) {
            setList
                .tcgRootSettingsButton()
                .refreshable { await model.refresh(request, using: sets) }
                .navigationDestination(for: CatalogSetDestination.self) { destination in
                    SetChecklistScreen(
                        destination: destination,
                        isVisible: isVisible,
                        collectionRevision: collectionRevision,
                        onWishlistMembershipChange: onWishlistMembershipChange,
                        addForm: addForm
                    )
                }
        }
        .cardArtworkCachePolicy(.search)
        .onChange(of: gameSelection.game) { _, game in
            if path.last?.game != game { path.removeAll() }
        }
        .task(id: isVisible ? request : nil) {
            guard isVisible else { return }
            await model.search(request, using: sets)
        }
    }

    private var setList: some View {
        TCGCollectionList(
            title: Text("Sets", bundle: .module),
            searchPrompt: Text("Set name or code", bundle: .module),
            query: $model.query,
            hidesScrollBackground: false,
            showsEmptyContent: false
        ) {
            TCGGameFilter(selection: gameBinding)
        } rows: {
            if showsInProgress {
                Section {
                    rows(.inProgress)
                } header: {
                    Text("In progress", bundle: .module)
                }
            }

            Section {
                rows(.all)
                if all.entries.isEmpty && !all.failed && !all.isLoading && !all.canLoadMore {
                    if all.hasLoaded {
                        Text("No sets found", bundle: .module)
                            .foregroundStyle(.secondary)
                    } else {
                        ProgressView()
                    }
                }
            } header: {
                Text("All sets", bundle: .module)
            }
        } emptyContent: {
            EmptyView()
        } footer: {
            EmptyView()
        }
    }

    private var gameBinding: Binding<CardGame> {
        Binding(get: { CardGame(client: gameSelection.game) }, set: { gameSelection.game = $0.clientGame })
    }

    private var request: TCGSetsScreenModel.Request {
        model.request(game: gameSelection.game, collectionRevision: collectionRevision)
    }

    private var all: SetPageState<CatalogSetSummary> { model.page(for: .all) }

    private var showsInProgress: Bool {
        let page = model.page(for: .inProgress)
        return !page.entries.isEmpty || page.canLoadMore
    }

    @ViewBuilder
    private func rows(_ section: TCGSetsScreenModel.Section) -> some View {
        let page = model.page(for: section)
        let rows = page.entries.map { (id: "\(section.rawValue):\($0.id)", summary: $0) }
        ForEach(rows, id: \.id) { row in
            NavigationLink(value: CatalogSetDestination(game: gameSelection.game, set: row.summary.set)) {
                CatalogSetRow(summary: row.summary)
                    .tcgCollectionListRow()
            }
        }
        if page.nextCursor != nil {
            TCGScrollPaginationTrigger(pageID: nextScrollPage(for: section)) { pageID in
                Task {
                    guard nextScrollPage(for: section) == pageID else { return }
                    await model.loadMore(section, for: request, using: sets)
                }
            }
        }
        if page.isLoading {
            ProgressView()
        } else if page.failed {
            Button {
                Task { await model.loadMore(section, for: request, using: sets) }
            } label: {
                Text("Retry", bundle: .module)
            }
        }
    }

    private func nextScrollPage(for section: TCGSetsScreenModel.Section) -> TCGScrollPageID<UUID>? {
        guard isVisible, path.isEmpty else { return nil }
        return model.nextScrollPage(section, for: request)
    }
}
