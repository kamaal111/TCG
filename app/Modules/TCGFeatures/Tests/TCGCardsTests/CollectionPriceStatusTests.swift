import SwiftUI
import Testing

@testable import TCGCards

@MainActor
struct CollectionPriceStatusTests {
    @Test func `Price status leaves the binder viewport dimensions unchanged`() throws {
        let viewport = Color.clear.frame(width: 320, height: 420)
        let idle = ImageRenderer(content: viewport.collectionPriceStatus(isVisible: false, bottomInset: 4))
        let loading = ImageRenderer(content: viewport.collectionPriceStatus(isVisible: true, bottomInset: 4))
        let idleFrame = try #require(idle.cgImage)
        let loadingFrame = try #require(loading.cgImage)

        #expect(idleFrame.width == 320)
        #expect(idleFrame.height == 420)
        #expect(loadingFrame.width == idleFrame.width)
        #expect(loadingFrame.height == idleFrame.height)
    }
}
