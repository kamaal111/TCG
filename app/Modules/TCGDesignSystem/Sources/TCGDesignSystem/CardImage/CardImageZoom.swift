import SwiftUI

struct CardImageZoom {
    private(set) var scale: CGFloat = 1
    private(set) var offset: CGSize = .zero

    mutating func setScale(_ value: CGFloat, viewport: CGSize, artwork: CGSize) {
        scale = min(max(value, 1), 6)
        pan(to: offset, viewport: viewport, artwork: artwork)
    }

    mutating func pan(to value: CGSize, viewport: CGSize, artwork: CGSize) {
        let horizontalLimit = max(0, (artwork.width * scale - viewport.width) / 2)
        let verticalLimit = max(0, (artwork.height * scale - viewport.height) / 2)
        offset = CGSize(
            width: min(max(value.width, -horizontalLimit), horizontalLimit),
            height: min(max(value.height, -verticalLimit), verticalLimit)
        )
    }

    mutating func reset() {
        scale = 1
        offset = .zero
    }
}
