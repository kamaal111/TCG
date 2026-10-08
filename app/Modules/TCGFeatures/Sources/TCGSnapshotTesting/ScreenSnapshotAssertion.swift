//
//  ScreenSnapshotAssertion.swift
//  TCGFeatures
//

import SnapshotTesting
import SwiftUI
import Testing

/// Waits for exclusive screen capture, then compares light and dark images with their recorded baselines.
///
/// Captures from other suites wait until both appearance assertions finish.
///
/// ```swift
/// await assertScreenSnapshot(testName: #function) { Text("Example screen") }
/// ```
@MainActor
public func assertScreenSnapshot<Screen: View>(
    testName: String,
    fileID: StaticString = #fileID,
    file filePath: StaticString = #filePath,
    line: UInt = #line,
    column: UInt = #column,
    @ViewBuilder screen: () -> Screen
) async {
    await ScreenSnapshotQueue.acquire()
    defer { ScreenSnapshotQueue.release() }

    #if os(iOS)
        let animationsWereEnabled = UIView.areAnimationsEnabled
        UIView.setAnimationsEnabled(false)
        defer { UIView.setAnimationsEnabled(animationsWereEnabled) }
    #endif

    for scheme in [ColorScheme.light, .dark] {
        #if os(macOS)
            assertSnapshot(
                of: makeMacOSScreen(screen: screen(), scheme: scheme),
                as: .image,
                named: "\(scheme)",
                fileID: fileID,
                file: filePath,
                testName: testName,
                line: line,
                column: column
            )
        #elseif os(iOS)
            let capture = MountedScreenSnapshot(
                screen: screen()
                    .environment(\.locale, Locale(identifier: "en_US"))
                    .transaction {
                        $0.animation = nil
                        $0.disablesAnimations = true
                    },
                scheme: scheme
            )
            let image = await capture.image()
            guard let image else {
                Issue.record(
                    "The mounted screen did not settle within twelve seconds.",
                    sourceLocation: SourceLocation(
                        fileID: "\(fileID)",
                        filePath: "\(filePath)",
                        line: Int(line),
                        column: Int(column)
                    )
                )
                return
            }
            assertSnapshot(
                of: image,
                as: .image,
                named: "iPhone-\(scheme)",
                fileID: fileID,
                file: filePath,
                testName: testName,
                line: line,
                column: column
            )
        #endif
    }
}

struct ScreenSnapshotSettling {
    private var previousFrame: Data?
    private var matchingFrames = 0
    private var lastChange: TimeInterval = 0

    mutating func observe(frame: Data, at timestamp: TimeInterval, hasActiveAnimations: Bool) -> Bool {
        if hasActiveAnimations || frame != previousFrame {
            matchingFrames = 0
            lastChange = timestamp
        } else {
            matchingFrames += 1
        }
        previousFrame = frame
        return matchingFrames >= 2 && timestamp - lastChange >= 0.5
    }

    #if os(iOS)
        static func hasActiveAnimations(in layer: CALayer) -> Bool {
            guard layer.speed != 0 else { return false }
            for key in layer.animationKeys() ?? [] {
                guard let animation = layer.animation(forKey: key) else { continue }
                // Liquid Glass uses infinite animations to track control geometry.
                // Those remain attached to a visually stationary hierarchy.
                guard animation.duration.isFinite else { continue }
                guard animation.duration > 0 else { continue }
                guard animation.repeatCount.isFinite else { continue }
                guard animation.repeatDuration.isFinite else { continue }
                return true
            }
            return (layer.sublayers ?? []).contains { hasActiveAnimations(in: $0) }
        }
    #endif
}

// Swift Testing runs suites concurrently. Keep each mounted hierarchy and both
// appearance comparisons exclusive within a test process.
@MainActor
private enum ScreenSnapshotQueue {
    private static var isCapturing = false
    private static var waiting: [CheckedContinuation<Void, Never>] = []

    static func acquire() async {
        if !isCapturing {
            isCapturing = true
            return
        }
        await withCheckedContinuation { waiting.append($0) }
    }

    static func release() {
        guard !waiting.isEmpty else {
            isCapturing = false
            return
        }
        waiting.removeFirst().resume()
    }
}

#if os(iOS)
    @MainActor
    private final class MountedScreenSnapshot: NSObject {
        private let window: ScreenSnapshotWindow
        private let controller: UIViewController
        private let hosting: UIViewController
        private let traits: UITraitCollection
        private var settling = ScreenSnapshotSettling()
        private var completion: CheckedContinuation<UIImage?, Never>?
        private var deadline: CFTimeInterval = 0

        init<Screen: View>(screen: Screen, scheme: ColorScheme) {
            let config = ViewImageConfig.iPhone13
            traits = config.traits.modifyingTraits {
                $0.userInterfaceStyle = scheme == .dark ? .dark : .light
                $0.activeAppearance = .active
            }
            window = ScreenSnapshotWindow(config: config)
            hosting = UIHostingController(rootView: screen)
            controller = UIViewController()
            super.init()

            // UIKit controls also resolve appearance through their window.
            // Pin it before mounting so host settings cannot change their symbols.
            window.traitOverrides.userInterfaceStyle = traits.userInterfaceStyle
            window.traitOverrides.activeAppearance = traits.activeAppearance
            controller.view.backgroundColor = .clear
            controller.view.frame = window.bounds
            hosting.view.frame = window.bounds
            hosting.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            controller.addChild(hosting)
            controller.view.addSubview(hosting.view)
            hosting.traitOverrides.userInterfaceStyle = traits.userInterfaceStyle
            hosting.traitOverrides.activeAppearance = traits.activeAppearance
            hosting.traitOverrides.horizontalSizeClass = traits.horizontalSizeClass
            hosting.traitOverrides.verticalSizeClass = traits.verticalSizeClass
            hosting.traitOverrides.userInterfaceIdiom = traits.userInterfaceIdiom
            hosting.traitOverrides.preferredContentSizeCategory = traits.preferredContentSizeCategory
            hosting.traitOverrides.layoutDirection = traits.layoutDirection
            hosting.traitOverrides.forceTouchCapability = traits.forceTouchCapability
            hosting.didMove(toParent: controller)
            window.rootViewController = controller
            window.isHidden = false
            controller.beginAppearanceTransition(true, animated: false)
            controller.endAppearanceTransition()
            controller.view.setNeedsLayout()
            controller.view.layoutIfNeeded()
            hosting.view.setNeedsLayout()
            hosting.view.layoutIfNeeded()
            // UIKit activity indicators keep animating even when UIView animations
            // are disabled. Capture a fixed layer time while retaining pixel settling.
            hosting.view.layer.speed = 0
            hosting.view.layer.timeOffset = 0
        }

        func image() async -> UIImage? {
            // CI can take several seconds to render a populated form under simulator load.
            // Keep the pixel and quiet-interval checks; only bound how long they may take.
            deadline = CACurrentMediaTime() + 12
            return await withCheckedContinuation { completion in
                self.completion = completion
                let displayLink = CADisplayLink(target: self, selector: #selector(captureFrame))
                displayLink.add(to: .main, forMode: .common)
            }
        }

        // Observe one mounted hierarchy instead of restarting SwiftUI and UIKit
        // initialization on each frame. The reference never participates in settling.
        @objc private func captureFrame(_ displayLink: CADisplayLink) {
            guard CACurrentMediaTime() < deadline else {
                finish(displayLink, image: nil)
                return
            }
            let view = hosting.view!
            view.layoutIfNeeded()
            let renderer = UIGraphicsImageRenderer(bounds: view.bounds, format: .init(for: traits))
            let image = renderer.image { view.layer.render(in: $0.cgContext) }
            guard let data = image.pngData() else {
                finish(displayLink, image: nil)
                return
            }
            // layer.render captures model values, which can remain unchanged during
            // an animation. Its pixels alone cannot prove the hierarchy has settled.
            guard
                settling.observe(
                    frame: data,
                    at: CACurrentMediaTime(),
                    hasActiveAnimations: ScreenSnapshotSettling.hasActiveAnimations(in: view.layer)
                )
            else { return }
            finish(displayLink, image: image)
        }

        private func finish(_ displayLink: CADisplayLink, image: UIImage?) {
            displayLink.invalidate()
            controller.beginAppearanceTransition(false, animated: false)
            controller.endAppearanceTransition()
            window.isHidden = true
            window.rootViewController = nil
            guard let completion else { preconditionFailure("A screen capture must have a waiting assertion.") }
            self.completion = nil
            completion.resume(returning: image)
        }
    }

    private final class ScreenSnapshotWindow: UIWindow {
        private let config: ViewImageConfig

        init(config: ViewImageConfig) {
            self.config = config
            guard let size = config.size else { preconditionFailure("Screen snapshots require a fixed device size.") }
            super.init(frame: CGRect(origin: .zero, size: size))
        }

        required init?(coder: NSCoder) {
            fatalError("Screen snapshot windows require a device configuration.")
        }

        override var safeAreaInsets: UIEdgeInsets { config.safeArea }
    }
#endif

#if os(macOS)
    // Keep bitmap dimensions independent of the host display scale.
    private final class SnapshotHostingView<Content: View>: NSHostingView<Content> {
        override func bitmapImageRepForCachingDisplay(in rect: NSRect) -> NSBitmapImageRep? {
            let bitmap = NSBitmapImageRep(
                bitmapDataPlanes: nil,
                pixelsWide: Int(rect.width * 2),
                pixelsHigh: Int(rect.height * 2),
                bitsPerSample: 8,
                samplesPerPixel: 4,
                hasAlpha: true,
                isPlanar: false,
                colorSpaceName: .deviceRGB,
                bytesPerRow: 0,
                bitsPerPixel: 0
            )
            bitmap?.size = rect.size
            return bitmap
        }
    }

    @MainActor
    private func makeMacOSScreen<Screen: View>(screen: Screen, scheme: ColorScheme) -> SnapshotHostingView<some View> {
        let hostingView = SnapshotHostingView(
            rootView:
                screen
                .frame(width: 1_280, height: 960, alignment: .topLeading)
                .preferredColorScheme(scheme)
                .environment(\.locale, Locale(identifier: "en_US"))
                .tint(.blue)
        )
        hostingView.appearance = NSAppearance(named: scheme == .dark ? .darkAqua : .aqua)
        hostingView.frame = NSRect(x: 0, y: 0, width: 1_280, height: 960)
        hostingView.wantsLayer = true
        hostingView.layer?.backgroundColor = (scheme == .dark ? NSColor.black : NSColor.white).cgColor

        return hostingView
    }
#endif
