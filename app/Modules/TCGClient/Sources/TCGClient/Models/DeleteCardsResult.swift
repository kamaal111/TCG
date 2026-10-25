import Foundation

public struct DeleteCardsResult: Equatable, Sendable {
    public let deletedIDs: [UUID]
    public let notFoundIDs: [UUID]

    public init(deletedIDs: [UUID], notFoundIDs: [UUID]) {
        self.deletedIDs = deletedIDs
        self.notFoundIDs = notFoundIDs
    }
}
