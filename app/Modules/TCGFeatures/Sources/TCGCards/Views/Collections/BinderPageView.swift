import SwiftUI
import TCGClient

struct BinderPageView: View {
    private enum Metrics {
        static let backgroundOpacity = 0.3
        static let cornerRadius: CGFloat = 12
    }

    struct Content {
        let collection: CardBinderCollection
        let page: BinderPage
        let cards: [CardWithPrice]
        let slotWidth: CGFloat
    }

    let content: Content
    let selectSlot: (BinderSlotSelection) -> Void
    let canArrange: Bool
    let interactionSession: BinderInteractionSession
    let moveSlot: (BinderSlotDragPayload, BinderPosition) -> Bool
    let navigate: (BinderPageDirection) -> Void
    @State private var scrollEdges = BinderScrollEdges()

    var body: some View {
        pageContent(width: content.slotWidth)
    }

    private func pageContent(width: CGFloat) -> some View {
        ScrollView([.horizontal, .vertical]) {
            LazyVStack(spacing: BinderPageMetrics.slotSpacing) {
                ForEach(1..<(content.collection.rows + 1), id: \.self) { row in
                    LazyHStack(spacing: BinderPageMetrics.slotSpacing) {
                        ForEach(1..<(content.collection.columns + 1), id: \.self) { column in
                            slot(row: row, column: column, width: width)
                        }
                    }
                }
            }
            .padding(BinderPageMetrics.pagePadding)
        }
        .onScrollGeometryChange(for: BinderScrollEdges.self) { geometry in
            BinderScrollEdges(
                leading: geometry.contentOffset.x <= -geometry.contentInsets.leading + 1,
                trailing: geometry.contentOffset.x + geometry.containerSize.width
                    >= geometry.contentSize.width + geometry.contentInsets.trailing - 1
            )
        } action: { _, edges in
            scrollEdges = edges
        }
        .background {
            BinderSwipeNavigationBridge(edges: scrollEdges, interactionSession: interactionSession, navigate: navigate)
        }
        .background(
            .quaternary.opacity(Metrics.backgroundOpacity),
            in: RoundedRectangle(cornerRadius: Metrics.cornerRadius)
        )
    }

    private func slot(row: Int, column: Int, width: CGFloat) -> some View {
        let position = BinderPosition(pageID: content.page.id, row: row, column: column)
        let slot = content.page.slots.first { $0.row == row && $0.column == column }
        let card = content.cards.first { $0.card.id == slot?.cardID }
        return BinderSlotView(
            content: .init(position: position, slot: slot, card: card, width: width),
            select: { selectSlot(.init(position: position, card: card)) },
            dragPayload: payload(slot: slot, card: card, position: position),
            interactionSession: interactionSession,
            canDrop: canArrange,
            moveSlot: moveSlot
        )
    }

    private func payload(slot: BinderSlot?, card: CardWithPrice?, position: BinderPosition) -> BinderSlotDragPayload? {
        guard canArrange else { return nil }
        guard card != nil else { return nil }
        guard let slot else { return nil }
        return BinderSlotDragPayload(
            collectionID: content.collection.id,
            revision: content.collection.revision,
            source: position,
            cardID: slot.cardID,
            quantity: slot.quantity
        )
    }
}
