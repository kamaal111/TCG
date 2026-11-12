import SwiftUI
import TCGClient
import TCGDesignSystem

struct BinderSlotView: View {
    @Environment(\.isEditingCollection) private var isEditingCollection

    private enum Metrics {
        static let badgePadding: CGFloat = 4
        static let borderOpacity = 0.3
        static let borderWidth: CGFloat = 1
        static let emptySlotDash: [CGFloat] = [4]
    }

    struct Content {
        let position: BinderPosition
        let slot: BinderSlot?
        let card: CardWithPrice?
        let width: CGFloat
    }

    let content: Content
    let select: () -> Void
    var dragPayload: BinderSlotDragPayload?
    var interactionSession: BinderInteractionSession?
    var canDrop = false
    var moveSlot: (BinderSlotDragPayload, BinderPosition) -> Bool = { _, _ in false }
    @State private var isTargeted = false

    var body: some View {
        draggableSlot
            .dropDestination(for: BinderSlotDragPayload.self) { items, _ in
                guard canDrop else { return false }
                guard items.count == 1, let payload = items.first else { return false }
                interactionSession?.end()
                return moveSlot(payload, content.position)
            } isTargeted: {
                isTargeted = $0
            }
            .overlay {
                if canDrop && isTargeted {
                    Rectangle().strokeBorder(.tint, lineWidth: 3).allowsHitTesting(false)
                }
            }
    }

    @ViewBuilder
    private var draggableSlot: some View {
        if let dragPayload {
            slotButton.onDrag {
                guard let data = try? JSONEncoder().encode(dragPayload) else { return NSItemProvider() }
                interactionSession?.payload = dragPayload
                let provider = NSItemProvider()
                provider.registerDataRepresentation(
                    forTypeIdentifier: BinderSlotDragPayload.contentType.identifier,
                    visibility: .ownProcess
                ) { completion in
                    completion(data, nil)
                    return nil
                }
                return provider
            }
        } else {
            slotButton
        }
    }

    private var slotButton: some View {
        Button(action: select) {
            ZStack(alignment: .bottomTrailing) {
                Rectangle().fill(.background)
                if let slot = content.slot {
                    if let card = content.card {
                        CardImageView(
                            url: card.price.price?.imageURL,
                            size: CGSize(width: content.width, height: height)
                        )
                        if card.price.price?.imageURL == nil {
                            Text(verbatim: card.card.name).font(.caption).padding(Metrics.badgePadding)
                        }
                    } else {
                        ProgressView()
                    }
                    Text("×\(slot.quantity)")
                        .font(.caption.bold())
                        .padding(Metrics.badgePadding)
                        .background(
                            .regularMaterial,
                            in: Capsule()
                        )
                } else {
                    Image(systemName: "plus")
                        .foregroundStyle(.secondary)
                        .frame(
                            maxWidth: .infinity,
                            maxHeight: .infinity
                        )
                }
            }
            .frame(width: content.width, height: height)
            .overlay(
                Rectangle()
                    .strokeBorder(
                        .secondary.opacity(Metrics.borderOpacity),
                        style: StrokeStyle(
                            lineWidth: Metrics.borderWidth,
                            dash: content.slot == nil ? Metrics.emptySlotDash : []
                        )
                    )
            )
        }
        .buttonStyle(.plain)
        .help(helpText)
        .disabled(content.slot != nil && content.card == nil)
        .accessibilityValue(Text(verbatim: content.card?.card.name ?? ""))
        .accessibilityLabel(
            Text(
                "Row \(content.position.row), column \(content.position.column), \(content.slot?.quantity ?? 0) copies",
                bundle: .module
            )
        )
    }

    private var height: CGFloat { (content.width * BinderPageMetrics.slotHeightToWidthRatio).rounded(.down) }

    private var helpText: Text {
        if content.slot == nil {
            Text("Place cards in this slot", bundle: .module)
        } else if isEditingCollection {
            Text("Edit slot contents", bundle: .module)
        } else {
            Text("Card details", bundle: .module)
        }
    }
}
