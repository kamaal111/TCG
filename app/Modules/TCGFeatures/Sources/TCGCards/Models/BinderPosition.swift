import Foundation

struct BinderPosition: Identifiable, Hashable, Codable, Sendable {
    let pageID: UUID
    let row: Int
    let column: Int
    var id: Self { self }
}
