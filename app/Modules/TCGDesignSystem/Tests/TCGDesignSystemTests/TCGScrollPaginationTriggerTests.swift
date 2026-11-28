import Testing

@testable import TCGDesignSystem

struct TCGScrollPaginationTriggerTests {
    @Test
    func `Requests each appearing cursor once until it advances`() {
        var requests = TCGScrollPaginationTrigger<String>.Requests()
        var requested: [String] = []

        requests.loadIfNeeded("page-2", isVisible: false) { requested.append($0) }
        #expect(requested.isEmpty)

        requests.loadIfNeeded("page-2", isVisible: true) { requested.append($0) }
        requests.loadIfNeeded(nil, isVisible: true) { requested.append($0) }
        requests.loadIfNeeded("page-2", isVisible: true) { requested.append($0) }
        #expect(requested == ["page-2"])

        requests.loadIfNeeded("page-3", isVisible: true) { requested.append($0) }
        #expect(requested == ["page-2", "page-3"])
    }

    @Test
    func `Accepts the same cursor for a new request`() {
        typealias Page = TCGScrollPageID<Int>
        let original = Page(scope: 1, cursor: "page-2")
        let replacement = Page(scope: 2, cursor: "page-2")
        var requests = TCGScrollPaginationTrigger<Page>.Requests()
        var requested: [Page] = []

        requests.loadIfNeeded(original, isVisible: true) { requested.append($0) }
        requests.loadIfNeeded(replacement, isVisible: true) { requested.append($0) }

        #expect(requested == [original, replacement])
    }
}
