import SwiftUI
import TCGCardDetails
import TCGClient
import TCGDesignSystem

struct SetChecklistCardDetail<AddForm: View>: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(TCGSets.self) private var sets
    @State private var model = SetChecklistDetailModel()
    @State private var attempt = 0

    let destination: CatalogSetDestination
    let card: CatalogSetCard
    let onWishlistMembershipChange: (String, Bool) -> Void
    let addForm: (PricedCard, @escaping () -> Void) -> AddForm

    var body: some View {
        Group {
            if let group = model.group {
                CardVariantDestination(group: group, purpose: .details) { selected in
                    PricedCardDetailView(
                        originalCard: selected,
                        group: .init(card: selected, variants: group.variants),
                        displayedCard: selected,
                        isWishlistEntry: false,
                        onWishlistRemoval: nil,
                        onWishlistMembershipChange: onWishlistMembershipChange,
                        addForm: addForm,
                        header: { EmptyView() },
                        priceFallback: { EmptyView() }
                    )
                }
            } else {
                NavigationStack {
                    ScrollView {
                        VStack(spacing: 12) {
                            CardArtworkView(url: card.imageURL, onExplore: nil)
                                .frame(maxWidth: 200, maxHeight: 280)
                            Text(card.printedNumber)
                            if model.failed {
                                Text("Card pricing is unavailable", bundle: .module)
                                Button {
                                    attempt += 1
                                } label: {
                                    Text("Retry", bundle: .module)
                                }
                            } else {
                                ProgressView()
                            }
                        }
                        .padding()
                    }
                    .navigationTitle(card.name)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button {
                                dismiss()
                            } label: {
                                Text("Done", bundle: .module)
                            }
                        }
                    }
                }
            }
        }
        .task(id: attempt) { await model.load(card, in: destination, using: sets) }
    }
}
