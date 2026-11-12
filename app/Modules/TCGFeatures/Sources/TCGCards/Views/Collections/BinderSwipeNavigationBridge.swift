import SwiftUI

#if os(iOS)
    import UIKit

    struct BinderSwipeNavigationBridge: UIViewRepresentable {
        let edges: BinderScrollEdges
        let interactionSession: BinderInteractionSession
        let navigate: (BinderPageDirection) -> Void

        func makeUIView(context: Context) -> TouchObserverView {
            TouchObserverView()
        }

        func updateUIView(_ view: TouchObserverView, context: Context) {
            view.edges = edges
            view.interactionSession = interactionSession
            view.navigate = navigate
        }

        static func dismantleUIView(_ view: TouchObserverView, coordinator: ()) {
            view.detach()
        }

        final class TouchObserverView: UIView, UIGestureRecognizerDelegate {
            var edges = BinderScrollEdges()
            var interactionSession: BinderInteractionSession?
            var navigate: ((BinderPageDirection) -> Void)?
            private var observer: TouchObserver?

            override func didMoveToWindow() {
                super.didMoveToWindow()
                detach()
                guard let window else { return }
                let observer = TouchObserver()
                observer.owner = self
                observer.delegate = self
                observer.cancelsTouchesInView = false
                observer.delaysTouchesBegan = false
                observer.delaysTouchesEnded = false
                window.addGestureRecognizer(observer)
                self.observer = observer
            }

            func detach() {
                if let observer { observer.view?.removeGestureRecognizer(observer) }
                observer = nil
            }

            func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
                guard let controller = Self.controller(of: self) else { return false }
                guard Self.controller(of: touch.view) === controller else { return false }
                return bounds.contains(touch.location(in: self))
            }

            private static func controller(of responder: UIResponder?) -> UIViewController? {
                var current = responder
                while let value = current {
                    if let controller = value as? UIViewController { return controller }
                    current = value.next
                }
                return nil
            }

            func gestureRecognizer(
                _ gestureRecognizer: UIGestureRecognizer,
                shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
            ) -> Bool {
                true
            }
        }

        final class TouchObserver: UIGestureRecognizer {
            weak var owner: TouchObserverView?
            private var origin: CGPoint?
            private var policy = BinderSwipeNavigation()

            override func canPrevent(_ preventedGestureRecognizer: UIGestureRecognizer) -> Bool { false }

            override func canBePrevented(by preventingGestureRecognizer: UIGestureRecognizer) -> Bool { false }

            override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
                guard event.allTouches?.count == 1 else {
                    policy.cancel()
                    state = .failed
                    return
                }
                origin = touches.first?.location(in: view)
                policy.begin(edges: owner?.edges ?? BinderScrollEdges())
                state = .began
            }

            override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
                if event.allTouches?.count != 1 { policy.cancel() }
                if owner?.interactionSession?.payload != nil { policy.cancel() }
                state = .changed
            }

            override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
                if let origin, let location = touches.first?.location(in: view) {
                    let translation = CGSize(width: location.x - origin.x, height: location.y - origin.y)
                    if let direction = policy.update(
                        translation: translation,
                        isDraggingCard: owner?.interactionSession?.payload != nil
                    ) {
                        owner?.navigate?(direction)
                    }
                }
                policy.cancel()
                owner?.interactionSession?.end()
                state = .ended
            }

            override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {
                policy.cancel()
                owner?.interactionSession?.end()
                state = .cancelled
            }
        }
    }
#elseif os(macOS)
    import AppKit

    struct BinderSwipeNavigationBridge: NSViewRepresentable {
        let edges: BinderScrollEdges
        let interactionSession: BinderInteractionSession
        let navigate: (BinderPageDirection) -> Void

        func makeNSView(context: Context) -> TrackpadObserverView {
            TrackpadObserverView()
        }

        func updateNSView(_ view: TrackpadObserverView, context: Context) {
            view.edges = edges
            view.interactionSession = interactionSession
            view.navigate = navigate
        }

        static func dismantleNSView(_ view: TrackpadObserverView, coordinator: ()) {
            view.detach()
        }

        final class TrackpadObserverView: NSView {
            var edges = BinderScrollEdges()
            var interactionSession: BinderInteractionSession?
            var navigate: ((BinderPageDirection) -> Void)?
            private var monitor: Any?
            private var policy = BinderSwipeNavigation()
            private var translation = CGSize.zero
            private var isTracking = false
            private var didTurn = false

            override func hitTest(_ point: NSPoint) -> NSView? { nil }

            override func viewDidMoveToWindow() {
                super.viewDidMoveToWindow()
                detach()
                guard window != nil else { return }
                monitor = NSEvent.addLocalMonitorForEvents(matching: [.scrollWheel, .leftMouseUp]) {
                    [weak self] event in
                    let consumed = MainActor.assumeIsolated { self?.consume(event) ?? false }
                    return consumed ? nil : event
                }
            }

            func detach() {
                if let monitor { NSEvent.removeMonitor(monitor) }
                monitor = nil
                isTracking = false
                policy.cancel()
            }

            private func consume(_ event: NSEvent) -> Bool {
                guard event.window === window else { return false }
                if event.type == .leftMouseUp {
                    interactionSession?.end()
                    return false
                }
                if !event.momentumPhase.isEmpty { return interactionSession?.suppressesMomentum == true }
                guard event.hasPreciseScrollingDeltas else { return false }
                if event.phase.contains(.began) {
                    let location = convert(event.locationInWindow, from: nil)
                    isTracking = bounds.contains(location)
                    didTurn = false
                    interactionSession?.suppressesMomentum = false
                    translation = .zero
                    policy.begin(edges: edges)
                }
                guard isTracking else { return false }
                if NSEvent.pressedMouseButtons != 0 || interactionSession?.payload != nil {
                    policy.cancel()
                    return false
                }
                translation.width += event.scrollingDeltaX
                translation.height += event.scrollingDeltaY
                if event.phase.contains(.cancelled) {
                    policy.cancel()
                    isTracking = false
                    return false
                }
                if event.phase.contains(.ended) {
                    if let direction = policy.update(translation: translation, isDraggingCard: false) {
                        didTurn = true
                        interactionSession?.suppressesMomentum = true
                        navigate?(direction)
                    }
                    isTracking = false
                    policy.cancel()
                }
                return didTurn
            }
        }
    }
#endif
