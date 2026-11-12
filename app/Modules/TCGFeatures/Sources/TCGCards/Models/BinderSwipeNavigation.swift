import Foundation

enum BinderPageDirection: Equatable {
    case previous
    case next
}

struct BinderScrollEdges: Equatable {
    var leading = true
    var trailing = true
}

struct BinderSwipeNavigation {
    private var edges = BinderScrollEdges()
    private var isActive = false
    private var hasTurned = false

    mutating func begin(edges: BinderScrollEdges) {
        self.edges = edges
        isActive = true
        hasTurned = false
    }

    mutating func update(translation: CGSize, isDraggingCard: Bool) -> BinderPageDirection? {
        guard isActive else { return nil }
        guard !hasTurned else { return nil }
        if isDraggingCard {
            cancel()
            return nil
        }
        guard abs(translation.width) >= 50 else { return nil }
        guard abs(translation.width) > abs(translation.height) * 1.5 else { return nil }
        let direction: BinderPageDirection = translation.width < 0 ? .next : .previous
        guard direction == .next ? edges.trailing : edges.leading else { return nil }
        hasTurned = true
        return direction
    }

    mutating func cancel() {
        isActive = false
    }
}
