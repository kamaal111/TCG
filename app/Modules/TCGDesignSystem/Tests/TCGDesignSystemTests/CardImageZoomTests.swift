import SwiftUI
import Testing

@testable import TCGDesignSystem

@Suite("Card Image Zoom Tests")
struct CardImageZoomTests {
    private let viewport = CGSize(width: 300, height: 500)

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
