import SwiftUI
import TCGClient

struct SetChecklistScreen<AddForm: View>: View {
    @Environment(TCGSets.self) private var sets
    @State private var model: SetChecklistScreenModel

    let destination: CatalogSetDestination
    let isVisible: Bool
    let collectionRevision: Int
    private let onWishlistMembershipChange: (String, Bool) -> Void
    private let addForm: (PricedCard, @escaping () -> Void) -> AddForm

    init(
        destination: CatalogSetDestination,
        isVisible: Bool,
        collectionRevision: Int,
        onWishlistMembershipChange: @escaping (String, Bool) -> Void,
        addForm: @escaping (PricedCard, @escaping () -> Void) -> AddForm
    ) {
        _model = State(initialValue: SetChecklistScreenModel(destination: destination))
        self.destination = destination
        self.isVisible = isVisible
        self.collectionRevision = collectionRevision
        self.onWishlistMembershipChange = onWishlistMembershipChange
        self.addForm = addForm
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                SetChecklistHeader(summary: model.summary, filter: $model.filter)
                SetChecklistGrid(cards: model.page.entries) { model.selected = $0 }
                pagination
            }
            .padding()
        }
        .navigationTitle(destination.set.name)
        .refreshable { await model.refresh(request, using: sets) }
        .task(id: isVisible ? request : nil) {
            guard isVisible else { return }
            await model.search(request, using: sets)
        }
        .sheet(item: $model.selected) { card in
            SetChecklistCardDetail(
                destination: destination,
                card: card,
                onWishlistMembershipChange: onWishlistMembershipChange,
                addForm: addForm
            )
        }
    }

    @ViewBuilder
    private var pagination: some View {
        if model.page.canLoadMore {
            Button {
                Task { await model.loadMore(for: request, using: sets) }
            } label: {
                Text(model.page.failed ? "Retry" : "Load more", bundle: .module)
                    .frame(maxWidth: .infinity)
            }
            .disabled(model.page.isLoading)
        } else if model.page.entries.isEmpty {
            if model.page.hasLoaded {
                Text("No cards in this view", bundle: .module)
                    .foregroundStyle(.secondary)
            } else {
                ProgressView()
            }
        }
    }

    private var request: SetChecklistScreenModel.Request {
        model.request(collectionRevision: collectionRevision)
    }
}
