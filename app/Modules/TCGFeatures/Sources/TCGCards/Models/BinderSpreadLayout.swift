import Foundation
import TCGClient

struct BinderSpreadLayout {
    let slotWidth: CGFloat
    let pageSize: CGSize
    let capacity: Int

    private init(slotWidth: CGFloat, pageSize: CGSize, capacity: Int) {
        self.slotWidth = slotWidth
        self.pageSize = pageSize
        self.capacity = capacity
    }

    static func make(collection: CardBinderCollection, viewport: CGSize) -> Self {
        let columns = CGFloat(collection.columns)
        let rows = CGFloat(collection.rows)
        let horizontal = (viewport.width - BinderPageMetrics.viewportInset) / columns - BinderPageMetrics.slotSpacing
        let vertical =
            ((viewport.height - BinderPageMetrics.viewportInset) / rows - BinderPageMetrics.slotSpacing)
            / BinderPageMetrics.slotHeightToWidthRatio
        let width = max(
            BinderPageMetrics.minimumSlotWidth,
            min(BinderPageMetrics.maximumBaseSlotWidth, horizontal, vertical)
        )
        .rounded(.down)
        let size = CGSize(
            width: columns * width + (columns - 1) * BinderPageMetrics.slotSpacing + BinderPageMetrics.pagePadding * 2,
            height: rows * (width * BinderPageMetrics.slotHeightToWidthRatio).rounded(.down)
                + (rows - 1) * BinderPageMetrics.slotSpacing + BinderPageMetrics.pagePadding * 2
        )
        let spreadWidth = size.width * CGFloat(BinderPageMetrics.maximumVisiblePages) + BinderPageMetrics.spreadSpacing
        let fits = spreadWidth <= viewport.width && size.height <= viewport.height
        return Self(slotWidth: width, pageSize: size, capacity: fits ? BinderPageMetrics.maximumVisiblePages : 1)
    }

    static func adjacentIndex(direction: BinderPageDirection, visibleRange: Range<Int>, capacity: Int, totalPages: Int)
        -> Int?
    {
        guard !visibleRange.isEmpty else { return nil }
        switch direction {
        case .previous:
            guard visibleRange.lowerBound > 0 else { return nil }
            return max(0, visibleRange.lowerBound - capacity)
        case .next:
            guard visibleRange.upperBound < totalPages else { return nil }
            return visibleRange.upperBound
        }
    }

    func pageRange(startingAt index: Int, totalPages: Int) -> Range<Int> {
        guard index < totalPages else { return totalPages..<totalPages }
        let start = max(0, index) / capacity * capacity
        return start..<min(start + capacity, totalPages)
    }
}
