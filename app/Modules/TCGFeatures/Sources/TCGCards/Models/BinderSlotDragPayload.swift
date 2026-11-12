import CoreTransferable
import Foundation
import TCGClient
import UniformTypeIdentifiers

struct BinderSlotDragPayload: Codable, Hashable, Sendable, Transferable {
    static let contentType = UTType(exportedAs: "io.kamaal.tcg.binder-slot", conformingTo: .data)

    let collectionID: UUID
    let revision: Int
    let source: BinderPosition
    let cardID: UUID
    let quantity: Int

    static var transferRepresentation: some TransferRepresentation {
        CodableRepresentation(contentType: contentType)
    }

    func matches(_ collection: CardBinderCollection) -> Bool {
        guard collectionID == collection.id else { return false }
        guard revision == collection.revision else { return false }
        guard let slot = BinderLayout.slot(in: collection, at: source) else { return false }
        return slot.cardID == cardID && slot.quantity == quantity
    }
}
