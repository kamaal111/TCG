import Foundation

public struct SaveBinderLayoutPayload: Codable, Equatable, Sendable {
    public let collection: CardBinderCollection
    public let moveFromUnfiledCardID: UUID?

    public init(collection: CardBinderCollection, moveFromUnfiledCardID: UUID?) {
        self.collection = collection
        self.moveFromUnfiledCardID = moveFromUnfiledCardID
    }
}
