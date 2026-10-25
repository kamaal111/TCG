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

    static func make(collection: CardBinderCollection, viewport: CGSize, zoom: Double) -> Self {
        let columns = CGFloat(collection.columns)
        let rows = CGFloat(collection.rows)
        let horizontal = (viewport.width - BinderPageMetrics.viewportInset) / columns - BinderPageMetrics.slotSpacing
        let vertical =
            ((viewport.height - BinderPageMetrics.viewportInset) / rows - BinderPageMetrics.slotSpacing)
            / BinderPageMetrics.slotHeightToWidthRatio
        let width = max(
            BinderPageMetrics.minimumSlotWidth,
            min(BinderPageMetrics.maximumBaseSlotWidth, horizontal, vertical) * zoom
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

    func pageRange(startingAt index: Int, totalPages: Int) -> Range<Int> {
        guard index < totalPages else { return totalPages..<totalPages }
        let start = max(0, index) / capacity * capacity
        return start..<min(start + capacity, totalPages)
    }
}
