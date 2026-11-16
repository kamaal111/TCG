import SwiftUI
import Testing

@testable import TCGDesignSystem

@Suite("Card Image Zoom Tests")
struct CardImageZoomTests {
    private let viewport = CGSize(width: 300, height: 500)
    private let offCenterAnchor = UnitPoint(x: 0.25, y: 0.25)

    @Test
    func `Pinch keeps the artwork under its starting anchor`() {
        let startingZoom = CardImageZoom()
        let zoom = startingZoom.applying(
            .init(magnification: 2, anchor: offCenterAnchor),
            viewport: viewport,
            artwork: viewport
        )
        #expect(zoom.scale == 2)
        #expect(zoom.offset == CGSize(width: 75, height: 125))
    }

    @Test
    func `Pinch accounts for the existing zoom and pan`() {
        var zoom = CardImageZoom()
        zoom.setScale(2, viewport: viewport, artwork: viewport)
        zoom.pan(to: CGSize(width: 20, height: 30), viewport: viewport, artwork: viewport)

        let result = zoom.applying(
            .init(magnification: 1.5, anchor: offCenterAnchor),
            viewport: viewport,
            artwork: viewport
        )
        #expect(result.scale == 3)
        #expect(result.offset == CGSize(width: 67.5, height: 107.5))
    }

    @Test
    func `Pinch uses the clamped scale to preserve its anchor`() {
        let startingZoom = CardImageZoom()
        let zoomed = startingZoom.applying(
            .init(magnification: 20, anchor: offCenterAnchor),
            viewport: viewport,
            artwork: viewport
        )
        #expect(zoomed.scale == 6)
        #expect(zoomed.offset == CGSize(width: 375, height: 625))

        let fitted = zoomed.applying(
            .init(magnification: 0.1, anchor: offCenterAnchor),
            viewport: viewport,
            artwork: viewport
        )
        #expect(fitted.scale == 1)
        #expect(fitted.offset == .zero)
    }

    @Test
    func `Pinch and drag keep artwork centered on an axis that still fits`() {
        let startingZoom = CardImageZoom()
        let zoom = startingZoom.applying(
            .init(magnification: 2, anchor: offCenterAnchor, translation: CGSize(width: 10, height: -30)),
            viewport: CGSize(width: 900, height: 500),
            artwork: CGSize(width: 350, height: 500)
        )
        #expect(zoom.scale == 2)
        #expect(zoom.offset == CGSize(width: 0, height: 95))
    }

    @Test
    func `Zoom stays between fit and six times magnification`() {
        var zoom = CardImageZoom()
        zoom.setScale(100, viewport: viewport, artwork: viewport)
        #expect(zoom.scale == 6)
        zoom.setScale(0.1, viewport: viewport, artwork: viewport)
        #expect(zoom.scale == 1)
    }

    @Test
    func `Pan stays inside the scaled viewport`() {
        var zoom = CardImageZoom()
        zoom.setScale(2, viewport: viewport, artwork: viewport)
        zoom.pan(to: CGSize(width: 900, height: -900), viewport: viewport, artwork: viewport)
        #expect(zoom.offset == CGSize(width: 150, height: -250))
    }

    @Test
    func `Reducing zoom clamps an existing pan`() {
        var zoom = CardImageZoom()
        zoom.setScale(4, viewport: viewport, artwork: viewport)
        zoom.pan(to: CGSize(width: 400, height: 700), viewport: viewport, artwork: viewport)
        zoom.setScale(2, viewport: viewport, artwork: viewport)
        #expect(zoom.offset == CGSize(width: 150, height: 250))
        zoom.setScale(1, viewport: viewport, artwork: viewport)
        #expect(zoom.offset == .zero)
    }

    @Test
    func `Portrait artwork cannot be panned out of a wide viewport`() {
        var zoom = CardImageZoom()
        let wideViewport = CGSize(width: 900, height: 500)
        let portrait = CGSize(width: 350, height: 500)
        zoom.setScale(6, viewport: wideViewport, artwork: portrait)
        zoom.pan(to: CGSize(width: 10_000, height: -10_000), viewport: wideViewport, artwork: portrait)
        #expect(zoom.offset == CGSize(width: 600, height: -1_250))
    }

    @Test
    func `Artwork narrower than the viewport stays centered horizontally`() {
        var zoom = CardImageZoom()
        let wideViewport = CGSize(width: 900, height: 500)
        let portrait = CGSize(width: 350, height: 500)
        zoom.setScale(2, viewport: wideViewport, artwork: portrait)
        zoom.pan(to: CGSize(width: 100, height: 100), viewport: wideViewport, artwork: portrait)
        #expect(zoom.offset == CGSize(width: 0, height: 100))
    }

    @Test
    func `Reset restores fit and centered artwork`() {
        var zoom = CardImageZoom()
        zoom.setScale(3, viewport: viewport, artwork: viewport)
        zoom.pan(to: CGSize(width: 100, height: 100), viewport: viewport, artwork: viewport)
        zoom.reset()
        #expect(zoom.scale == 1)
        #expect(zoom.offset == .zero)
    }
}
