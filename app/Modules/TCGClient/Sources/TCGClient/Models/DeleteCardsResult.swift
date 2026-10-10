public struct DeleteCardsResult: Equatable, Sendable {
    public let deletedIDs: [String]
    public let notFoundIDs: [String]

    public init(deletedIDs: [String], notFoundIDs: [String]) {
        self.deletedIDs = deletedIDs
        self.notFoundIDs = notFoundIDs
    }
}
