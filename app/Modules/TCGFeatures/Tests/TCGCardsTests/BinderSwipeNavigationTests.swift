import Foundation
import Testing

@testable import TCGCards

struct BinderSwipeNavigationTests {
    @Test(arguments: [(-60.0, BinderPageDirection.next), (60.0, .previous)])
    func `Horizontal swipe turns once per gesture`(_ example: (Double, BinderPageDirection)) {
        var policy = BinderSwipeNavigation()
        policy.begin(edges: .init())
        #expect(policy.update(translation: CGSize(width: example.0, height: 10), isDraggingCard: false) == example.1)
        #expect(policy.update(translation: CGSize(width: example.0 * 2, height: 10), isDraggingCard: false) == nil)
        policy.begin(edges: .init())
        #expect(policy.update(translation: CGSize(width: example.0, height: 10), isDraggingCard: false) == example.1)
    }

    @Test(arguments: [CGSize(width: 49, height: 0), CGSize(width: 60, height: 50), CGSize(width: 0, height: 100)])
    func `Small diagonal and vertical movements do not turn pages`(translation: CGSize) {
        var policy = BinderSwipeNavigation()
        policy.begin(edges: .init())
        #expect(policy.update(translation: translation, isDraggingCard: false) == nil)
    }

    @Test func `Only the edge at gesture start enables turning`() {
        var policy = BinderSwipeNavigation()
        policy.begin(edges: .init(leading: true, trailing: false))
        #expect(policy.update(translation: CGSize(width: -100, height: 0), isDraggingCard: false) == nil)
        policy.begin(edges: .init(leading: false, trailing: true))
        #expect(policy.update(translation: CGSize(width: 100, height: 0), isDraggingCard: false) == nil)
        policy.begin(edges: .init(leading: false, trailing: true))
        #expect(policy.update(translation: CGSize(width: -100, height: 0), isDraggingCard: false) == .next)
    }

    @Test func `Cancelled gestures and momentum without a new gesture cannot turn pages`() {
        var policy = BinderSwipeNavigation()
        #expect(policy.update(translation: CGSize(width: -100, height: 0), isDraggingCard: false) == nil)
        policy.begin(edges: .init())
        policy.cancel()
        #expect(policy.update(translation: CGSize(width: -100, height: 0), isDraggingCard: false) == nil)
    }

    @Test func `Dragging a card cancels navigation until the next gesture`() {
        var policy = BinderSwipeNavigation()
        policy.begin(edges: .init())
        #expect(policy.update(translation: CGSize(width: -100, height: 0), isDraggingCard: true) == nil)
        #expect(policy.update(translation: CGSize(width: -100, height: 0), isDraggingCard: false) == nil)
        policy.begin(edges: .init())
        #expect(policy.update(translation: CGSize(width: -100, height: 0), isDraggingCard: false) == .next)
    }

    @Test func `Navigation matches arrows for single pages spreads boundaries and an odd final page`() {
        #expect(
            BinderSpreadLayout.adjacentIndex(direction: .next, visibleRange: 0..<1, capacity: 1, totalPages: 5) == 1
        )
        #expect(
            BinderSpreadLayout.adjacentIndex(direction: .next, visibleRange: 0..<2, capacity: 2, totalPages: 5) == 2
        )
        #expect(
            BinderSpreadLayout.adjacentIndex(direction: .next, visibleRange: 2..<4, capacity: 2, totalPages: 5) == 4
        )
        #expect(
            BinderSpreadLayout.adjacentIndex(direction: .next, visibleRange: 4..<5, capacity: 2, totalPages: 5) == nil
        )
        #expect(
            BinderSpreadLayout.adjacentIndex(direction: .previous, visibleRange: 4..<5, capacity: 2, totalPages: 5) == 2
        )
        #expect(
            BinderSpreadLayout.adjacentIndex(direction: .previous, visibleRange: 0..<2, capacity: 2, totalPages: 5)
                == nil
        )
        #expect(
            BinderSpreadLayout.adjacentIndex(direction: .next, visibleRange: 0..<0, capacity: 1, totalPages: 0) == nil
        )
    }
}
