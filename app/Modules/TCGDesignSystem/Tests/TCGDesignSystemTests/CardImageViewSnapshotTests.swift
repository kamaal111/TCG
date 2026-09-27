import SnapshotTesting
import SwiftUI
import Testing

@testable import TCGDesignSystem

@Suite("Card Image View Snapshot Tests")
@MainActor
struct CardImageViewSnapshotTests {
    @Test
    func `Renders loading`() async {
        let loader = LoadingCardImageLoader()
        assertCardImageSnapshot(testName: #function) {
            CardImageView(url: TestFixtures.imageURL)
                .cardImageLoader(loader)
        }
        await loader.finish()
    }

    @Test
    func `Renders a failed load`() {
        assertCardImageSnapshot(testName: #function) {
            CardImageView(url: TestFixtures.imageURL)
                .cardImageLoader(PreviewCardImageLoader(outcome: .failure))
        }
    }

    @Test
    func `Renders a missing URL`() {
        assertCardImageSnapshot(testName: #function) { CardImageView(url: nil) }
    }

    private func assertCardImageSnapshot<CardImage: View>(
        testName: String,
        @ViewBuilder cardImage: () -> CardImage
    ) {
        for scheme in [ColorScheme.light, .dark] {
            #if os(macOS)
                assertSnapshot(
                    of: makeMacOSCardImage(
                        cardImage: cardImage().environment(\.cardImageReduceMotionOverride, true),
                        scheme: scheme
                    ),
                    as: .image,
                    named: "\(scheme)",
                    testName: testName
                )
            #elseif os(iOS)
                assertSnapshot(
                    of: cardImage().environment(\.cardImageReduceMotionOverride, true),
                    as: .image(
                        layout: .fixed(width: 44, height: 61),
                        traits: UITraitCollection(userInterfaceStyle: scheme == .dark ? .dark : .light)
                    ),
                    named: "iPhone-\(scheme)",
                    testName: testName
                )
            #endif
        }
    }

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

        private func makeMacOSCardImage<CardImage: View>(
            cardImage: CardImage,
            scheme: ColorScheme
        ) -> SnapshotHostingView<some View> {
            let hostingView = SnapshotHostingView(rootView: cardImage.preferredColorScheme(scheme))
            hostingView.appearance = NSAppearance(named: scheme == .dark ? .darkAqua : .aqua)
            hostingView.frame = NSRect(x: 0, y: 0, width: 44, height: 61)
            hostingView.wantsLayer = true
            hostingView.layer?.backgroundColor = (scheme == .dark ? NSColor.black : NSColor.white).cgColor

            return hostingView
        }
    #endif
}

private struct LoadingCardImageLoader: CardImageLoader {
    private let gate = LoadingGate()

    func cachedImage(for url: URL) -> Image? { nil }

    func image(for url: URL) async -> Image? {
        await gate.wait()
    }

    func finish() async {
        await gate.finish()
    }
}

private actor LoadingGate {
    private var continuations: [CheckedContinuation<Image?, Never>] = []
    private var isFinished = false

    func wait() async -> Image? {
        guard !isFinished else { return nil }
        return await withCheckedContinuation { continuation in
            if isFinished {
                continuation.resume(returning: nil)
                return
            }
            continuations.append(continuation)
        }
    }

    func finish() {
        isFinished = true
        for continuation in continuations {
            continuation.resume(returning: nil)
        }
        continuations = []
    }
}

private enum TestFixtures {
    static let imageURL = URL(string: "https://images.example.com/card.png")!
}
