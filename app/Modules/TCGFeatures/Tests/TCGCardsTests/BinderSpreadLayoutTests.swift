import Foundation
import Testing

@testable import TCGCards

struct BinderSpreadLayoutTests {
    private let desktop = CGSize(width: 1200, height: 800)
    private let phone = CGSize(width: 358, height: 600)

    @Test func `Two two by two pages fit side by side on a wide screen without shrinking slots`() {
        let wide = layout(viewport: desktop, zoom: 1)
        #expect(wide.capacity == 2)
        #expect(wide.slotWidth == BinderPageMetrics.maximumBaseSlotWidth)
        #expect(wide.pageSize.width * 2 + BinderPageMetrics.spreadSpacing <= desktop.width)
        #expect(wide.pageSize.height <= desktop.height)
    }

    @Test func `A narrow screen retains a single page`() {
        let narrow = layout(viewport: phone, zoom: 1)
        #expect(narrow.capacity == 1)
        #expect(narrow.pageSize.width <= phone.width)
    }

    @Test func `Zooming retains the enlarged slot size and switches back to one page`() {
        let zoomed = layout(viewport: desktop, zoom: 3)
        #expect(zoomed.capacity == 1)
        #expect(zoomed.slotWidth == BinderPageMetrics.maximumBaseSlotWidth * 3)
    }

    @Test func `A spread includes the last odd page without inventing another page`() {
        let spread = layout(viewport: desktop, zoom: 1)
        #expect(spread.pageRange(startingAt: 0, totalPages: 5) == 0..<2)
        #expect(spread.pageRange(startingAt: 1, totalPages: 2) == 0..<2)
        #expect(spread.pageRange(startingAt: 3, totalPages: 5) == 2..<4)
        #expect(spread.pageRange(startingAt: 2, totalPages: 5) == 2..<4)
        #expect(spread.pageRange(startingAt: 4, totalPages: 5) == 4..<5)
        #expect(spread.pageRange(startingAt: 5, totalPages: 5).isEmpty)
        #expect(spread.pageRange(startingAt: 0, totalPages: 0).isEmpty)
    }

    @Test(arguments: [(columns: 1, rows: 4, capacity: 2), (columns: 4, rows: 1, capacity: 1)])
    func `Custom dimensions determine whether a pair fits`(_ dimensions: (columns: Int, rows: Int, capacity: Int)) {
        let spread = BinderSpreadLayout.make(
            collection: CollectionTestFixtures.binder(columns: dimensions.columns, rows: dimensions.rows),
            viewport: CGSize(width: 600, height: 1000),
            zoom: 1
        )
        #expect(spread.capacity == dimensions.capacity)
    }

    private func layout(viewport: CGSize, zoom: Double) -> BinderSpreadLayout {
        .make(collection: CollectionTestFixtures.binder(columns: 2, rows: 2), viewport: viewport, zoom: zoom)
    }
}
