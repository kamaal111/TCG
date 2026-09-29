import Foundation
import Testing

@testable import TCGSnapshotTesting

#if os(iOS)
    import QuartzCore
#endif

@Suite("Screen Snapshot Settling Tests")
struct ScreenSnapshotSettlingTests {
    @Test
    func `Unchanged pixels do not settle while a layer animation is active`() {
        var settling = ScreenSnapshotSettling()
        let frame = Data([1])

        let observations = [
            settling.observe(frame: frame, at: 0, hasActiveAnimations: true),
            settling.observe(frame: frame, at: 0.25, hasActiveAnimations: true),
            settling.observe(frame: frame, at: 1, hasActiveAnimations: true),
            settling.observe(frame: frame, at: 1.25, hasActiveAnimations: false),
            settling.observe(frame: frame, at: 1.5, hasActiveAnimations: false),
        ]

        #expect(observations == [false, false, false, false, true])
    }

    @Test
    func `A changed pixel restarts the half second quiet interval`() {
        var settling = ScreenSnapshotSettling()
        let initialFrame = Data([1])
        let finalFrame = Data([2])

        let observations = [
            settling.observe(frame: initialFrame, at: 0, hasActiveAnimations: false),
            settling.observe(frame: initialFrame, at: 0.25, hasActiveAnimations: false),
            settling.observe(frame: finalFrame, at: 0.5, hasActiveAnimations: false),
            settling.observe(frame: finalFrame, at: 0.75, hasActiveAnimations: false),
            settling.observe(frame: finalFrame, at: 1, hasActiveAnimations: false),
        ]

        #expect(observations == [false, false, false, false, true])
    }

    @Test
    func `A delayed display link still requires two matching frames`() {
        var settling = ScreenSnapshotSettling()
        let frame = Data([1])

        let observations = [
            settling.observe(frame: frame, at: 0, hasActiveAnimations: false),
            settling.observe(frame: frame, at: 1, hasActiveAnimations: false),
            settling.observe(frame: frame, at: 2, hasActiveAnimations: false),
        ]

        #expect(observations == [false, false, true])
    }

    #if os(iOS)
        @Test
        @MainActor
        func `Finite transitions on descendant layers block capture`() {
            let root = CALayer()
            let child = CALayer()
            root.addSublayer(child)
            let animation = CABasicAnimation(keyPath: "opacity")
            animation.duration = 1
            child.add(animation, forKey: "entrance")

            #expect(ScreenSnapshotSettling.hasActiveAnimations(in: root))
        }

        @Test
        @MainActor
        func `Infinite geometry tracking does not block a stationary snapshot`() {
            let layer = CALayer()
            let animation = CABasicAnimation(keyPath: "position")
            animation.duration = .infinity
            animation.isRemovedOnCompletion = false
            layer.add(animation, forKey: "geometry-tracking")

            #expect(layer.animationKeys() == ["geometry-tracking"])
            #expect(!ScreenSnapshotSettling.hasActiveAnimations(in: layer))
        }

        @Test
        @MainActor
        func `Infinite repetitions do not block a stationary snapshot`() {
            let layer = CALayer()
            let animation = CABasicAnimation(keyPath: "position")
            animation.duration = 1
            animation.repeatCount = .infinity
            layer.add(animation, forKey: "repeating")

            #expect(layer.animationKeys() == ["repeating"])
            #expect(!ScreenSnapshotSettling.hasActiveAnimations(in: layer))
        }
    #endif
}
