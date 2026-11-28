import SwiftUI

/// Place after the last item in a scrollable region with a continuation.
/// Keep the marker mounted with a `nil` page ID while the request is pending.
public struct TCGScrollPaginationTrigger<PageID: Hashable>: View {
    @State private var requests = Requests()

    private let pageID: PageID?
    private let load: (PageID) -> Void

    public init(pageID: PageID?, load: @escaping (PageID) -> Void) {
        self.pageID = pageID
        self.load = load
    }

    public var body: some View {
        Color.clear
            .frame(height: 24)
            .accessibilityHidden(true)
            .onScrollVisibilityChange(threshold: 0.25) { isVisible in
                requests.loadIfNeeded(pageID, isVisible: isVisible, using: load)
            }
            .id(pageID)
    }

    struct Requests {
        private var lastStarted: PageID?

        mutating func loadIfNeeded(_ pageID: PageID?, isVisible: Bool, using load: (PageID) -> Void) {
            guard isVisible, let pageID, pageID != lastStarted else { return }
            lastStarted = pageID
            load(pageID)
        }
    }
}

public struct TCGScrollPageID<Scope: Hashable>: Hashable {
    private let scope: Scope
    public let cursor: String

    public init(scope: Scope, cursor: String) {
        self.scope = scope
        self.cursor = cursor
    }
}
